{
  pkgs,
  src,
}:
pkgs.buildNpmPackage {
  pname = "eulesia-api";
  version = "1.0.0";
  inherit src;

  nodejs = pkgs.nodejs_22;
  npmDepsHash = "sha256-R87ScebRdFaS2a0++e0WPjr5Rh5L9gBapTTpmltbIaI=";
  npmWorkspace = "apps/api";
  makeCacheWritable = true;
  npmRebuildFlags = ["--ignore-scripts"];

  nativeBuildInputs = with pkgs; [
    python3
    pkg-config
  ];

  buildInputs = with pkgs; [
    vips
    libargon2
  ];

  npmBuildScript = "build";

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/eulesia-api
    cp -r apps/api/dist $out/share/eulesia-api/dist
    cp -r apps/api/src $out/share/eulesia-api/src
    cp -r node_modules $out/share/eulesia-api/node_modules
    rm -f $out/share/eulesia-api/node_modules/@eulesia/api
    cp apps/api/package.json $out/share/eulesia-api/package.json
    cp apps/api/drizzle.config.ts $out/share/eulesia-api/drizzle.config.ts
    cp apps/api/tsconfig.json $out/share/eulesia-api/tsconfig.json

    mkdir -p $out/bin
    cat > $out/bin/eulesia-api <<EOF
    #!${pkgs.runtimeShell}
    set -euo pipefail
    exec ${pkgs.nodejs_22}/bin/node $out/share/eulesia-api/dist/index.js "\$@"
    EOF
    chmod +x $out/bin/eulesia-api

    cat > $out/bin/eulesia-api-import-minutes <<EOF
    #!${pkgs.runtimeShell}
    set -euo pipefail
    cd $out/share/eulesia-api
    exec ${pkgs.nodejs_22}/bin/node $out/share/eulesia-api/dist/services/import/run-minutes-import.js "\$@"
    EOF
    chmod +x $out/bin/eulesia-api-import-minutes

    cat > $out/bin/eulesia-api-migrate <<EOF
    #!${pkgs.runtimeShell}
    set -euo pipefail
    exec ${pkgs.nodejs_22}/bin/node $out/share/eulesia-api/dist/scripts/run-startup-migrations.js "\$@"
    EOF
    chmod +x $out/bin/eulesia-api-migrate

    cat > $out/bin/eulesia-api-bootstrap-admins <<EOF
    #!${pkgs.runtimeShell}
    set -euo pipefail
    exec ${pkgs.nodejs_22}/bin/node $out/share/eulesia-api/dist/scripts/bootstrap-admins.js "\$@"
    EOF
    chmod +x $out/bin/eulesia-api-bootstrap-admins

    runHook postInstall
  '';
}
