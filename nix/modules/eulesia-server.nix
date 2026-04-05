{
  config,
  lib,
  ...
}:
with lib; let
  cfg = config.services.eulesia-server;
in {
  options.services.eulesia-server = {
    enable = mkEnableOption "Eulesia v2 Rust server";

    package = mkOption {
      type = types.package;
      description = "The eulesia-server package to use.";
    };

    user = mkOption {
      type = types.str;
      default = config.services.eulesia.user or "eulesia";
      description = "User to run the server as (defaults to eulesia user).";
    };

    group = mkOption {
      type = types.str;
      default = config.services.eulesia.group or "eulesia";
      description = "Group to run the server as.";
    };

    host = mkOption {
      type = types.str;
      default = "127.0.0.1";
      description = "Address to bind to.";
    };

    port = mkOption {
      type = types.port;
      default = 3002;
      description = "Port to listen on.";
    };

    logLevel = mkOption {
      type = types.str;
      default = "info";
      description = "Log level (trace, debug, info, warn, error).";
    };

    logJson = mkOption {
      type = types.bool;
      default = true;
      description = "Output logs as JSON.";
    };

    database = {
      createLocally = mkOption {
        type = types.bool;
        default = true;
        description = "Provision a PostgreSQL database locally for the v2 server.";
      };

      name = mkOption {
        type = types.str;
        default = "eulesia_v2";
        description = "Database name for the v2 server.";
      };

      url = mkOption {
        type = types.str;
        default = "postgresql:///${cfg.database.name}";
        description = "Database connection string.";
      };
    };

    frontendOrigin = mkOption {
      type = types.str;
      default = "https://${config.services.eulesia.appDomain or "localhost"}";
      description = "Frontend origin for CORS.";
    };

    cookieDomain = mkOption {
      type = types.nullOr types.str;
      default = config.services.eulesia.auth.cookieDomain or null;
      description = "Cookie domain for session cookies.";
    };

    cookieSecure = mkOption {
      type = types.bool;
      default = true;
      description = "Set Secure flag on session cookies.";
    };

    sessionSecretFile = mkOption {
      type = types.nullOr types.path;
      default = null;
      description = "Path to file containing the session secret.";
    };

    sessionMaxAgeDays = mkOption {
      type = types.int;
      default = 30;
      description = "Session cookie max age in days.";
    };

    meilisearch = {
      url = mkOption {
        type = types.nullOr types.str;
        default = null;
        description = "Meilisearch URL.";
      };
      masterKeyFile = mkOption {
        type = types.nullOr types.path;
        default = null;
        description = "Path to Meilisearch master key file.";
      };
    };

    uploadDir = mkOption {
      type = types.str;
      default = "/var/lib/eulesia/uploads";
      description = "Directory for file uploads.";
    };

    idura = {
      enable = mkOption {
        type = types.bool;
        default = false;
        description = "Enable Idura FTN authentication.";
      };
      domain = mkOption {
        type = types.str;
        default = "";
      };
      clientId = mkOption {
        type = types.str;
        default = "";
      };
      callbackUrl = mkOption {
        type = types.str;
        default = "";
      };
      signingKeyFile = mkOption {
        type = types.nullOr types.path;
        default = null;
      };
      encryptionKeyFile = mkOption {
        type = types.nullOr types.path;
        default = null;
      };
    };

    extraEnvironment = mkOption {
      type = types.attrsOf types.str;
      default = {};
      description = "Extra environment variables for the v2 server.";
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      {
        assertion = !(cfg.database.createLocally && cfg.user != (config.services.eulesia.user or "eulesia"));
        message = "Local PostgreSQL expects eulesia-server user to match for peer auth.";
      }
    ];

    services.postgresql = mkIf cfg.database.createLocally {
      enable = true;
      ensureDatabases = [cfg.database.name];
      ensureUsers = [
        {
          name = cfg.user;
          ensureDBOwnership = true;
        }
      ];
    };

    # Pre-create citext extension (requires superuser) and grant schema
    # access to the application user.
    systemd.services.eulesia-server-db-setup = mkIf cfg.database.createLocally {
      description = "Eulesia v2 database setup (extensions + permissions)";
      wantedBy = ["multi-user.target"];
      after = ["postgresql.service" "postgresql-setup.service"];
      requires = ["postgresql.service" "postgresql-setup.service"];
      path = [config.services.postgresql.package];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        User = "postgres";
      };
      script = ''
        psql -d ${cfg.database.name} -c "CREATE EXTENSION IF NOT EXISTS citext;"
        psql -d ${cfg.database.name} -c "GRANT ALL ON SCHEMA public TO ${cfg.user};"
      '';
    };

    systemd.services.eulesia-server = {
      description = "Eulesia v2 API Server";
      wantedBy = ["multi-user.target"];
      wants = ["network-online.target"];
      after =
        ["network-online.target"]
        ++ optional cfg.database.createLocally "eulesia-server-db-setup.service";
      requires =
        optional cfg.database.createLocally "eulesia-server-db-setup.service";

      environment =
        {
          DATABASE_URL = cfg.database.url;
          EULESIA_HOST = cfg.host;
          EULESIA_PORT = toString cfg.port;
          EULESIA_LOG_LEVEL = cfg.logLevel;
          EULESIA_LOG_JSON =
            if cfg.logJson
            then "true"
            else "";
          EULESIA_FRONTEND_ORIGIN = cfg.frontendOrigin;
          EULESIA_COOKIE_SECURE =
            if cfg.cookieSecure
            then "true"
            else "";
          EULESIA_SESSION_MAX_AGE_DAYS = toString cfg.sessionMaxAgeDays;
          UPLOAD_DIR = cfg.uploadDir;
        }
        // optionalAttrs (cfg.cookieDomain != null) {
          EULESIA_COOKIE_DOMAIN = cfg.cookieDomain;
        }
        // optionalAttrs (cfg.meilisearch.url != null) {
          MEILI_URL = cfg.meilisearch.url;
        }
        // optionalAttrs cfg.idura.enable {
          IDURA_DOMAIN = cfg.idura.domain;
          IDURA_CLIENT_ID = cfg.idura.clientId;
          IDURA_CALLBACK_URL = cfg.idura.callbackUrl;
        }
        // cfg.extraEnvironment;

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        Restart = "on-failure";
        RestartSec = 5;
        StateDirectory = "eulesia";
      };

      # Load secrets from files into environment variables at startup,
      # then exec the server binary.
      script = let
        readSecret = file: var: ''
          if [ -f "${file}" ]; then
            export ${var}="$(cat "${file}")"
          fi
        '';
      in ''
        ${optionalString (cfg.sessionSecretFile != null) (readSecret cfg.sessionSecretFile "EULESIA_SESSION_SECRET")}
        ${optionalString (cfg.meilisearch.masterKeyFile != null) (readSecret cfg.meilisearch.masterKeyFile "MEILI_API_KEY")}
        ${optionalString (cfg.idura.enable && cfg.idura.signingKeyFile != null) "export IDURA_SIGNING_KEY_FILE=\"${cfg.idura.signingKeyFile}\""}
        ${optionalString (cfg.idura.enable && cfg.idura.encryptionKeyFile != null) "export IDURA_ENCRYPTION_KEY_FILE=\"${cfg.idura.encryptionKeyFile}\""}
        exec ${cfg.package}/bin/eulesia-server
      '';
    };
  };
}
