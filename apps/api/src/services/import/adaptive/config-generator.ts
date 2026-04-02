/**
 * AI Config Generator
 *
 * Uses AI to analyze a municipality website and generate
 * a FetcherConfig JSON for the AdaptiveFetcher.
 *
 * Flow:
 * 1. page-analyzer.ts fetches and cleans the page HTML
 * 2. If system detected by heuristics → use template (no AI needed)
 * 3. Otherwise → send to AI (GPT/Claude via multi-provider) for analysis
 * 4. Validate result against Zod schema
 * 5. Test fetch to verify config works
 */

import { analyzePage } from "./page-analyzer.js";
import { getTemplate } from "./templates.js";
import { validateFetcherConfig, type FetcherConfig } from "./config-schema.js";
import { callAi, parseAiJson } from "./ai-provider.js";

export interface ConfigGenerationResult {
  success: boolean;
  config?: FetcherConfig;
  systemType: string;
  generatedBy: "template" | "ai";
  error?: string;
}

/**
 * Generate a FetcherConfig for a given municipality URL.
 *
 * Tries template first (free, instant, reliable).
 * Falls back to AI generation for unknown systems.
 */
export async function generateFetcherConfig(
  baseUrl: string,
  country: string,
  systemHint?: string,
): Promise<ConfigGenerationResult> {
  // Step 1: If we have a system hint, try template directly
  if (systemHint) {
    const template = getTemplate(systemHint);
    if (template) {
      return {
        success: true,
        config: template,
        systemType: systemHint,
        generatedBy: "template",
      };
    }
  }

  // Step 2: Analyze the page
  const analysis = await analyzePage(baseUrl);
  if (!analysis || analysis.error) {
    return {
      success: false,
      systemType: "unknown",
      generatedBy: "ai",
      error: `Page analysis failed: ${analysis?.error || "unknown error"}`,
    };
  }

  // Step 3: If heuristics detected a known system, use template
  if (analysis.structure?.patterns.detectedSystem) {
    const detected = analysis.structure.patterns.detectedSystem;
    const template = getTemplate(detected);
    if (template) {
      return {
        success: true,
        config: template,
        systemType: detected,
        generatedBy: "template",
      };
    }
  }

  // Step 4: AI generation for unknown systems
  console.log(`   [config-gen] Unknown system for ${baseUrl}, using AI...`);

  try {
    const config = await generateConfigWithAi(
      baseUrl,
      country,
      analysis.cleanedHtml,
      analysis.structure,
    );
    return {
      success: true,
      config,
      systemType: "ai-generated",
      generatedBy: "ai",
    };
  } catch (err) {
    return {
      success: false,
      systemType: "unknown",
      generatedBy: "ai",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Use AI to generate a FetcherConfig from page HTML.
 */
async function generateConfigWithAi(
  baseUrl: string,
  country: string,
  cleanedHtml: string,
  structure: NonNullable<Awaited<ReturnType<typeof analyzePage>>>["structure"],
): Promise<FetcherConfig> {
  const structureHints = structure
    ? `
Page structure:
- Title: ${structure.title}
- Language: ${structure.lang}
- Links: ${structure.linkCount} total, ${structure.pdfLinks.length} PDFs
- Tables: ${structure.tableCount}, Forms: ${structure.formCount}
- Date format detected: ${structure.patterns.detectedDateFormat || "none"}
- Meeting keywords found: ${structure.patterns.hasMeetingKeywords}
- Protocol keywords found: ${structure.patterns.hasProtocolKeywords}

Sample links:
${structure.sampleLinks
  .slice(0, 10)
  .map((l) => `  - "${l.text}" → ${l.href}`)
  .join("\n")}

PDF links:
${structure.pdfLinks
  .slice(0, 5)
  .map((l) => `  - ${l}`)
  .join("\n")}
`
    : "";

  const systemPrompt = `You are a web scraping configuration expert. You analyze municipal meeting minutes websites and generate declarative scraping configurations.

Your output must be a valid JSON object matching this schema:

{
  "meetingList": {
    "url": "URL template with {baseUrl} placeholder",
    "method": "GET",
    "meetingSelector": {
      "pattern": "JavaScript regex to find meeting links in HTML",
      "groups": { "id": <group_number>, "url": <group_number>, "title": <group_number_optional>, "date": <group_number_optional> }
    },
    "dateFormat": "DD.MM.YYYY or YYYY-MM-DD or DD/MM/YYYY",
    "protocolIndicators": ["keywords that indicate minutes vs agenda"],
    "maxMeetings": 10
  },
  "contentExtraction": {
    "strategy": "pdf" | "html" | "pdf-with-html-fallback",
    "pdf": { "urlTemplate": "optional", "linkPattern": "optional regex to find PDF links" },
    "html": { "itemPattern": "optional regex for agenda items", "contentSelectors": ["CSS selectors"] }
  }
}

Rules for regex patterns:
- Use JavaScript regex syntax
- Use capture groups (...) for extracting data
- The "groups" object maps field names to capture group indices (0-based numbering of groups)
- Keep patterns simple and robust
- Avoid catastrophic backtracking (no nested quantifiers like (a+)+)
- Max pattern length: 500 characters

Important:
- Analyze the actual HTML structure, don't guess
- If the page has PDF links to meeting documents, prefer PDF strategy
- If the page has HTML content for each agenda item, use HTML strategy
- Look for real patterns in the provided HTML, not generic ones`;

  const userPrompt = `Analyze this municipal meeting website and generate a FetcherConfig.

Base URL: ${baseUrl}
Country: ${country}
${structureHints}

Page HTML (cleaned):
${cleanedHtml}

Generate a JSON FetcherConfig that can extract meeting listings and content from this page. Return ONLY the JSON object, no explanation.`;

  const response = await callAi(
    "config-generation",
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    {
      temperature: 0.1,
      maxTokens: 4000,
      jsonMode: true,
    },
  );

  const parsed = parseAiJson<unknown>(response);
  const validation = validateFetcherConfig(parsed);

  if (!validation.success) {
    throw new Error(
      `AI-generated config validation failed: ${validation.errors.join(", ")}`,
    );
  }

  return validation.data;
}

/**
 * Test a FetcherConfig by attempting to fetch meetings.
 * Returns true if the config produces at least one meeting.
 */
export async function testConfig(
  baseUrl: string,
  config: FetcherConfig,
): Promise<{ success: boolean; meetingCount: number; error?: string }> {
  try {
    // Resolve the meeting list URL
    const origin = new URL(baseUrl).origin;
    const listUrl = config.meetingList.url
      .replace("{baseUrl}", baseUrl)
      .replace("{origin}", origin);

    const response = await fetch(listUrl, {
      headers: {
        "User-Agent": "Eulesia/1.0 (civic platform; contact@eulesia.eu)",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        success: false,
        meetingCount: 0,
        error: `HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    const regex = new RegExp(config.meetingList.meetingSelector.pattern, "gi");
    let count = 0;
    while (regex.exec(html) !== null) count++;

    return {
      success: count > 0,
      meetingCount: count,
      error:
        count === 0
          ? "No meetings found with the configured pattern"
          : undefined,
    };
  } catch (err) {
    return {
      success: false,
      meetingCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
