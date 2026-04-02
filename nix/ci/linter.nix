_: {
  perSystem = {
    config,
    pkgs,
    ...
  }: let
    nodejs = pkgs.nodejs_22;

    shellFunctions = ''
      resolve_repo_root() {
        local dir
        dir="$PWD"

        while [ "$dir" != "/" ]; do
          if [ -f "$dir/flake.nix" ] && [ -f "$dir/package-lock.json" ]; then
            printf '%s\n' "$dir"
            return 0
          fi

          dir="''${dir%/*}"
          if [ -z "$dir" ]; then
            dir="/"
          fi
        done

        echo "Unable to locate the repository root from $PWD" >&2
        return 1
      }

      repo_root="$(resolve_repo_root)"
      cd "$repo_root"

      ensure_dependencies() {
        local lockfile_snapshot
        lockfile_snapshot="node_modules/.eulesia-package-lock.json"

        if [ ! -f "$lockfile_snapshot" ] || ! cmp -s package-lock.json "$lockfile_snapshot" >/dev/null 2>&1; then
          echo "Installing npm dependencies..."
          npm ci
          cp package-lock.json "$lockfile_snapshot"
        fi
      }
    '';

    formatRepo = pkgs.writeShellApplication {
      name = "format-repo";
      runtimeInputs = [config.treefmt.build.wrapper];
      text = ''
        set -euo pipefail
        ${shellFunctions}
        HOME="$(mktemp -d)"
        export HOME
        XDG_CACHE_HOME="$HOME/.cache"
        export XDG_CACHE_HOME
        mkdir -p "$XDG_CACHE_HOME"
        treefmt
      '';
    };

    checkFormat = pkgs.writeShellApplication {
      name = "check-format";
      runtimeInputs = [config.treefmt.build.wrapper];
      text = ''
        set -euo pipefail
        ${shellFunctions}
        HOME="$(mktemp -d)"
        export HOME
        XDG_CACHE_HOME="$HOME/.cache"
        export XDG_CACHE_HOME
        mkdir -p "$XDG_CACHE_HOME"
        treefmt --fail-on-change
      '';
    };

    lintNix = pkgs.writeShellApplication {
      name = "lint-nix";
      runtimeInputs = with pkgs; [statix deadnix];
      text = ''
        set -euo pipefail
        ${shellFunctions}
        statix check flake.nix
        statix check nix
        deadnix --fail flake.nix nix
      '';
    };

    lintFrontend = pkgs.writeShellApplication {
      name = "lint-frontend";
      runtimeInputs = with pkgs; [
        nodejs
        python3
        pkg-config
        vips
        libargon2
      ];
      text = ''
        set -euo pipefail
        ${shellFunctions}
        ensure_dependencies
        npm run lint:web:fix
        npm run lint:web
        npm run typecheck:web
      '';
    };

    lintApi = pkgs.writeShellApplication {
      name = "lint-api";
      runtimeInputs = with pkgs; [
        nodejs
        python3
        pkg-config
        vips
        libargon2
      ];
      text = ''
        set -euo pipefail
        ${shellFunctions}
        ensure_dependencies
        npm run lint:api:fix
        npm run lint:api
        npm run typecheck:api
      '';
    };

    lint = pkgs.writeShellApplication {
      name = "lint";
      runtimeInputs = [lintNix lintFrontend lintApi];
      text = ''
        set -euo pipefail
        lint-nix
        lint-frontend
        lint-api
      '';
    };

    testFrontend = pkgs.writeShellApplication {
      name = "test-frontend";
      runtimeInputs = with pkgs; [
        nodejs
        python3
        pkg-config
        vips
        libargon2
      ];
      text = ''
        set -euo pipefail
        ${shellFunctions}
        ensure_dependencies
        npm run test:web:run
      '';
    };

    testApi = pkgs.writeShellApplication {
      name = "test-api";
      runtimeInputs = with pkgs; [
        nodejs
        python3
        pkg-config
        vips
        libargon2
      ];
      text = ''
        set -euo pipefail
        ${shellFunctions}
        ensure_dependencies
        npm run test:api:run
      '';
    };

    test = pkgs.writeShellApplication {
      name = "eulesia-test";
      runtimeInputs = [testFrontend testApi];
      text = ''
        set -euo pipefail
        test-frontend
        test-api
      '';
    };

    ciCheck = pkgs.writeShellApplication {
      name = "ci-check";
      runtimeInputs = [checkFormat lint test pkgs.nix];
      text = ''
        set -euo pipefail
        ${shellFunctions}
        check-format
        lint
        eulesia-test
        nix build .#frontend .#api .#nixosConfigurations.eulesia-vm.config.microvm.runner.qemu
      '';
    };
  in {
    pre-commit = {
      check.enable = true;
      settings.hooks = {
        treefmt = {
          enable = true;
          name = "treefmt";
          description = "Run treefmt in write mode";
          entry = "${formatRepo}/bin/format-repo";
          language = "system";
          pass_filenames = false;
        };

        lint-nix = {
          enable = true;
          name = "lint-nix";
          description = "Run statix and deadnix";
          entry = "${lintNix}/bin/lint-nix";
          language = "system";
          pass_filenames = false;
        };

        lint-frontend = {
          enable = true;
          name = "lint-frontend";
          description = "Run frontend ESLint and type checking";
          entry = "${lintFrontend}/bin/lint-frontend";
          language = "system";
          pass_filenames = false;
        };

        lint-api = {
          enable = true;
          name = "lint-api";
          description = "Run API ESLint and type checking";
          entry = "${lintApi}/bin/lint-api";
          language = "system";
          pass_filenames = false;
        };
      };
    };

    packages = {
      format-repo = formatRepo;
      check-format = checkFormat;
      lint-nix = lintNix;
      lint-frontend = lintFrontend;
      lint-api = lintApi;
      inherit lint test;
      test-frontend = testFrontend;
      test-api = testApi;
      ci-check = ciCheck;
    };

    apps = {
      format = {
        type = "app";
        program = "${formatRepo}/bin/format-repo";
        meta.description = "Format the repository with treefmt";
      };
      check-format = {
        type = "app";
        program = "${checkFormat}/bin/check-format";
        meta.description = "Check formatting with treefmt";
      };
      lint = {
        type = "app";
        program = "${lint}/bin/lint";
        meta.description = "Run Nix, frontend, and API lint/typecheck commands";
      };
      test = {
        type = "app";
        program = "${test}/bin/eulesia-test";
        meta.description = "Run frontend and API test suites";
      };
      ci-check = {
        type = "app";
        program = "${ciCheck}/bin/ci-check";
        meta.description = "Run the runner-agnostic CI check pipeline";
      };
    };
  };
}
