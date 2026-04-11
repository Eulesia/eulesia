import { useMemo } from "react";
import { LinkPreview } from "./LinkPreview";

const URL_REGEX = /https?:\/\/[^\s<>]+/g;
const TRAILING_PUNCT = /[.,;:!?)]+$/;

interface LinkifiedTextProps {
  text: string;
  className?: string;
  showPreviews?: boolean;
}

export function LinkifiedText({
  text,
  className,
  showPreviews = true,
}: LinkifiedTextProps) {
  const { elements, urls } = useMemo(() => {
    const els: React.ReactNode[] = [];
    const foundUrls: string[] = [];
    let lastIndex = 0;
    const regex = new RegExp(URL_REGEX.source, "g");
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        els.push(text.slice(lastIndex, match.index));
      }

      let url = match[0];
      let trailing = "";
      const punct = TRAILING_PUNCT.exec(url);
      if (punct) {
        trailing = punct[0];
        url = url.slice(0, -trailing.length);
      }

      foundUrls.push(url);
      els.push(
        <a
          key={`link-${match.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline break-all hover:opacity-80"
        >
          {url}
        </a>,
      );
      if (trailing) els.push(trailing);
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      els.push(text.slice(lastIndex));
    }

    return { elements: els, urls: foundUrls };
  }, [text]);

  if (urls.length === 0) {
    return <p className={className}>{text}</p>;
  }

  return (
    <>
      <p className={className}>{elements}</p>
      {showPreviews && urls.map((url) => <LinkPreview key={url} url={url} />)}
    </>
  );
}
