{inputs, ...}: {
  perSystem = {pkgs, ...}: let
    repoSrc = pkgs.lib.cleanSource ../.;
    generateIduraJwks = import ./generate-idura-jwks.nix {inherit pkgs;};

    # JS/pnpm builds
    pnpmDeps = pkgs.fetchPnpmDeps {
      pname = "eulesia";
      src = repoSrc;
      hash = "sha256-qlldk/k7fMgpNkusOj9Z63eMaiYrh/N+E189h0hUT2M=";
      fetcherVersion = 3;
    };

    frontend = import ./frontend.nix {
      inherit pkgs pnpmDeps;
      src = repoSrc;
      pwaMode = "disabled";
    };
    frontendTest = import ./frontend.nix {
      inherit pkgs pnpmDeps;
      src = repoSrc;
      pwaMode = "disabled";
    };
    fullBuild = pkgs.runCommand "eulesia-build" {} ''
      mkdir -p $out
      ln -s ${frontend} $out/frontend
      ln -s ${server} $out/server
    '';

    # Rust builds
    craneLib = (inputs.crane.mkLib pkgs).overrideToolchain (
      p: p.rust-bin.stable.latest.default
    );

    rustBuilds = import ./server.nix {
      inherit pkgs craneLib;
      src = repoSrc;
    };
    server = rustBuilds.package;
    inherit (rustBuilds) jobs;
  in {
    packages = {
      inherit frontend frontendTest server jobs pnpmDeps;
      build = fullBuild;
      generate-idura-jwks = generateIduraJwks;
      default = fullBuild;
      # Exposed as packages so checks.nix can inherit them without circular deps.
      server-clippy = rustBuilds.clippy;
      server-test = rustBuilds.test;
    };

    apps = {
      server = {
        type = "app";
        program = "${server}/bin/eulesia-server";
        meta.description = "Run the Eulesia Rust API server";
      };
      jobs = {
        type = "app";
        program = "${jobs}/bin/eulesia-jobs";
        meta.description = "Run the Eulesia scheduled jobs service";
      };
      generate-idura-jwks = {
        type = "app";
        program = "${generateIduraJwks}/bin/generate-idura-jwks";
        meta.description = "Generate FTN-compliant Idura client keys and public JWKS";
      };
      default = {
        type = "app";
        program = "${server}/bin/eulesia-server";
        meta.description = "Run the Eulesia Rust API server";
      };
    };
  };
}
