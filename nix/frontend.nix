{
  pkgs,
  src,
}:
pkgs.buildNpmPackage {
  pname = "eulesia-frontend";
  version = "0.0.0";
  inherit src;

  nodejs = pkgs.nodejs_22;
  npmDepsHash = "sha256-R87ScebRdFaS2a0++e0WPjr5Rh5L9gBapTTpmltbIaI=";
  makeCacheWritable = true;
  npmRebuildFlags = ["--ignore-scripts"];

  npmBuildScript = "build";

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r dist/* $out/
    runHook postInstall
  '';
}
