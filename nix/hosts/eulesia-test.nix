{
  config,
  eulesiaPackages,
  lib,
  pkgs,
  ...
}: {
  imports = [
    ./lib/hetzner-cloud-hardware.nix
    ./eulesia-test-disks.nix
    ../modules/eulesia.nix
  ];

  networking = {
    hostName = "eulesia-test";
    useDHCP = lib.mkDefault true;
    firewall = {
      enable = true;
      allowedTCPPorts = [
        80
        443
      ];
      extraCommands = ''
        iptables -A INPUT -p tcp -s 10.0.1.2 --dport 22 -j ACCEPT
      '';
      extraStopCommands = ''
        iptables -D INPUT -p tcp -s 10.0.1.2 --dport 22 -j ACCEPT || true
      '';
    };
  };

  users.users.root = {
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPy3xxwKnAgznj0mSvCBriRYky98laGZE+DNHN5zaBSz julius.koskela@digimuoto.com"
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMWz74cO4Y257P8md+OgkVyReEjarD7Ec3dxdW+HNy3e markus.sjoberg@aihiolabs.com"
    ];
  };

  sops = {
    age.keyFile = "/var/lib/sops-nix/key.txt";
    secrets =
      (import ./lib/eulesia-secrets.nix {
        inherit config;
        secretDir = ../../secrets/test;
      })
      // {
        "traefik-basic-auth-password" = {
          owner = "root";
          group = "root";
          format = "binary";
          sopsFile = ../../secrets/test/traefik-basic-auth-password.enc;
          path = "/run/secrets/traefik-basic-auth-password";
        };
      };
  };

  services = {
    openssh = {
      enable = true;
      settings = {
        KbdInteractiveAuthentication = false;
        PasswordAuthentication = false;
        PermitRootLogin = "prohibit-password";
      };
    };

    nginx = {
      defaultListenAddresses = ["127.0.0.1"];
      defaultHTTPListenPort = 8080;
      appendHttpConfig = ''
        map $http_x_forwarded_proto $eulesia_forwarded_proto {
          default $http_x_forwarded_proto;
          "" $scheme;
        }
      '';
      virtualHosts = {
        "api.test.eulesia.org".locations."/".extraConfig = ''
          proxy_set_header X-Forwarded-Proto $eulesia_forwarded_proto;
        '';

        "test.eulesia.org".locations = {
          "/.well-known/".extraConfig = ''
            proxy_set_header X-Forwarded-Proto $eulesia_forwarded_proto;
          '';
          "/api/".extraConfig = ''
            proxy_set_header X-Forwarded-Proto $eulesia_forwarded_proto;
          '';
          "/health".extraConfig = ''
            proxy_set_header X-Forwarded-Proto $eulesia_forwarded_proto;
          '';
          "/sitemap.xml".extraConfig = ''
            proxy_set_header X-Forwarded-Proto $eulesia_forwarded_proto;
          '';
          "/uploads/".extraConfig = ''
            proxy_set_header X-Forwarded-Proto $eulesia_forwarded_proto;
          '';
        };

        "admin.test.eulesia.org".locations = {
          "/.well-known/".extraConfig = ''
            proxy_set_header X-Forwarded-Proto $eulesia_forwarded_proto;
          '';
          "/api/".extraConfig = ''
            proxy_set_header X-Forwarded-Proto $eulesia_forwarded_proto;
          '';
          "/health".extraConfig = ''
            proxy_set_header X-Forwarded-Proto $eulesia_forwarded_proto;
          '';
          "/uploads/".extraConfig = ''
            proxy_set_header X-Forwarded-Proto $eulesia_forwarded_proto;
          '';
        };
      };
    };

    traefik = {
      enable = true;

      staticConfigOptions = {
        entryPoints = {
          web = {
            address = ":80";
            http.redirections.entrypoint = {
              to = "websecure";
              scheme = "https";
            };
          };
          websecure = {
            address = ":443";
            http.tls.certResolver = "letsencrypt";
          };
        };

        certificatesResolvers.letsencrypt.acme = {
          email = "admin@eulesia.eu";
          storage = "/var/lib/traefik/acme.json";
          httpChallenge.entryPoint = "web";
        };

        log.level = "INFO";
        accessLog = {};
      };

      dynamicConfigOptions.http = {
        middlewares = {
          eulesia-test-auth.basicAuth = {
            usersFile = "/run/eulesia-test/traefik-basic-auth.users";
            realm = "Eulesia Test";
          };

          security-headers.headers = {
            frameDeny = true;
            contentTypeNosniff = true;
            browserXssFilter = true;
            referrerPolicy = "no-referrer-when-downgrade";
            sslRedirect = true;
            stsSeconds = 31536000;
            stsIncludeSubdomains = true;
            stsPreload = true;
          };
        };

        routers = {
          eulesia = {
            rule = "Host(`test.eulesia.org`)";
            service = "eulesia";
            entryPoints = ["websecure"];
            middlewares = [
              "eulesia-test-auth"
              "security-headers"
            ];
            tls.certResolver = "letsencrypt";
          };

          eulesia-api = {
            rule = "Host(`api.test.eulesia.org`)";
            service = "eulesia";
            entryPoints = ["websecure"];
            middlewares = [
              "eulesia-test-auth"
              "security-headers"
            ];
            tls.certResolver = "letsencrypt";
          };

          eulesia-admin = {
            rule = "Host(`admin.test.eulesia.org`)";
            service = "eulesia";
            entryPoints = ["websecure"];
            middlewares = [
              "eulesia-test-auth"
              "security-headers"
            ];
            tls.certResolver = "letsencrypt";
          };
        };

        services.eulesia.loadBalancer.servers = [
          {
            url = "http://127.0.0.1:8080";
          }
        ];
      };
    };

    eulesia = {
      enable = true;
      package = eulesiaPackages.api;
      frontendPackage = eulesiaPackages.frontend;
      appDomain = "test.eulesia.org";
      apiDomain = "api.test.eulesia.org";
      adminDomain = "admin.test.eulesia.org";
      tls = {
        enable = false;
        acmeEmail = null;
      };
      email = {
        provider = "smtp";
        from = "noreply@aihiolabs.com";
        smtp = {
          host = "mail.infomaniak.com";
          port = 587;
          secure = false;
          userFile = config.sops.secrets."smtp-user".path;
          passFile = config.sops.secrets."smtp-pass".path;
        };
      };
      auth = {
        bootstrapAdminAccountsFile =
          config.sops.secrets."admin-accounts.json".path;
        sessionSecretFile = config.sops.secrets."session-secret".path;
        registrationMode = "ftn-open";
        cookieDomain = ".test.eulesia.org";
        idura = {
          enable = true;
          domain = "eulesia-test.criipto.id";
          clientId = "urn:my:application:identifier:923383";
          callbackUrl = "https://test.eulesia.org/api/v1/auth/ftn/callback";
          signingKeyFile =
            config.sops.secrets."idura-signing-key.jwk.json".path;
          encryptionKeyFile =
            config.sops.secrets."idura-encryption-key.jwk.json".path;
        };
      };
      meilisearch.masterKeyFile = config.sops.secrets."meili-master-key".path;
      ai.mistralApiKeyFile = config.sops.secrets."mistral-api-key".path;
      push = {
        vapidPublicKeyFile = config.sops.secrets."vapid-public-key".path;
        vapidPrivateKeyFile = config.sops.secrets."vapid-private-key".path;
        firebaseServiceAccountKeyFile =
          config.sops.secrets."firebase-service-account.json".path;
      };
      extraEnvironment = {
        APP_URL = "https://test.eulesia.org";
        API_URL = "https://test.eulesia.org";
      };
    };
  };

  environment.systemPackages = with pkgs; [
    curl
  ];

  systemd.services.eulesia-test-traefik-basic-auth = {
    description = "Generate Traefik basic auth users file for Eulesia test";
    wantedBy = ["multi-user.target"];
    before = ["traefik.service"];
    wants = ["sops-install-secrets.service"];
    after = ["sops-install-secrets.service"];
    unitConfig = {
      ConditionPathExists = config.sops.secrets."traefik-basic-auth-password".path;
    };
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      set -euo pipefail

      install -d -m 0750 -o traefik -g traefik /run/eulesia-test
      PASSWORD="$(${pkgs.coreutils}/bin/tr -d '\n' < ${config.sops.secrets."traefik-basic-auth-password".path})"
      HASH="$(${pkgs.openssl}/bin/openssl passwd -apr1 "$PASSWORD")"

      printf 'eulesia-test:%s\n' "$HASH" > /run/eulesia-test/traefik-basic-auth.users
      chown traefik:traefik /run/eulesia-test/traefik-basic-auth.users
      chmod 0400 /run/eulesia-test/traefik-basic-auth.users
    '';
  };

  systemd.services.traefik = {
    wants = ["eulesia-test-traefik-basic-auth.service"];
    after = ["eulesia-test-traefik-basic-auth.service"];
  };

  system.stateVersion = "24.11";
}
