{
  config,
  eulesiaPackages,
  lib,
  pkgs,
  ...
}: {
  imports = [
    ./lib/hetzner-cloud-hardware.nix
    ./eulesia-prod-disks.nix
    ../modules/eulesia.nix
    ../modules/eulesia-jobs.nix
    ../modules/eulesia-server.nix
  ];

  # Keep store clean — 3 generations in GRUB, weekly GC
  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 14d";
  };

  networking = {
    hostName = "eulesia-prod";
    useDHCP = lib.mkDefault true;
    defaultGateway6 = {
      address = "fe80::1";
      interface = "enp1s0";
    };
    interfaces.enp1s0.ipv6 = {
      addresses = [
        {
          address = "2a01:4f9:c012:160d::1";
          prefixLength = 64;
        }
      ];
      routes = [
        {
          address = "fe80::1";
          prefixLength = 128;
        }
      ];
    };
    firewall = {
      enable = true;
      allowedTCPPorts = [
        22
        80
        443
      ];
    };
  };

  users.users.root = {
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPy3xxwKnAgznj0mSvCBriRYky98laGZE+DNHN5zaBSz julius.koskela@digimuoto.com"
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMWz74cO4Y257P8md+OgkVyReEjarD7Ec3dxdW+HNy3e markus.sjoberg@aihiolabs.com"
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJyy8u8n/+aRPQM6TF9p7bnY4n/bNVvWdBCOCBb38P/O eulesia-deploy@mercury"
    ];
  };

  sops = {
    age.keyFile = "/var/lib/sops-nix/key.txt";
    secrets =
      lib.removeAttrs
      (import ./lib/eulesia-secrets.nix {
        inherit config;
        secretDir = ../../secrets/prod;
      })
      ["firebase-service-account.json"];
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

          redirect-to-eulesia-org.redirectRegex = {
            regex = "^https?://[^/]+(.*)";
            replacement = "https://eulesia.org\${1}";
            permanent = true;
          };
        };

        routers = {
          eulesia = {
            rule = "Host(`eulesia.org`) || Host(`www.eulesia.org`)";
            service = "eulesia";
            entryPoints = ["websecure"];
            middlewares = [
              "security-headers"
            ];
            tls = {
              certResolver = "letsencrypt";
              domains = [
                {
                  main = "eulesia.org";
                  sans = ["www.eulesia.org"];
                }
              ];
            };
          };

          eulesia-api = {
            rule = "Host(`api.eulesia.org`)";
            service = "eulesia";
            entryPoints = ["websecure"];
            middlewares = [
              "security-headers"
            ];
            tls.certResolver = "letsencrypt";
          };

          eulesia-admin = {
            rule = "Host(`admin.eulesia.org`)";
            service = "eulesia";
            entryPoints = ["websecure"];
            middlewares = [
              "security-headers"
            ];
            tls.certResolver = "letsencrypt";
          };

          # Redirect .com and .eu domains to eulesia.org
          eulesia-redirect = {
            rule = "Host(`eulesia.com`) || Host(`www.eulesia.com`) || Host(`eulesia.eu`) || Host(`www.eulesia.eu`)";
            service = "eulesia";
            entryPoints = ["websecure"];
            middlewares = [
              "redirect-to-eulesia-org"
            ];
            tls = {
              certResolver = "letsencrypt";
              domains = [
                {
                  main = "eulesia.com";
                  sans = ["www.eulesia.com"];
                }
                {
                  main = "eulesia.eu";
                  sans = ["www.eulesia.eu"];
                }
              ];
            };
          };
        };

        services.eulesia.loadBalancer.servers = [
          {
            url = "http://127.0.0.1:3002";
          }
        ];
      };
    };

    eulesia = {
      enable = true;
      frontendPackage = eulesiaPackages.frontend;
      nginx.enable = false;
      appDomain = "eulesia.org";
      apiDomain = "api.eulesia.org";
      adminDomain = "admin.eulesia.org";
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
        cookieDomain = ".eulesia.org";
        idura = {
          enable = true;
          domain = "eulesia.idura.broker";
          clientId = "urn:my:application:identifier:524753";
          callbackUrl = "https://eulesia.org/api/v1/auth/ftn/callback";
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
        # Native push stays disabled on prod until a real Firebase service
        # account is provisioned and the host secret set is extended again.
        firebaseServiceAccountKeyFile = null;
      };
      extraEnvironment = {
        APP_URL = "https://eulesia.org";
        API_URL = "https://eulesia.org";
      };
    };

    # Rust server — serves API + frontend, sole backend for Traefik
    eulesia-server = {
      enable = true;
      package = eulesiaPackages.server;
      frontendDir = "${eulesiaPackages.frontend}";
      frontendOrigin = "https://eulesia.org";
      webauthnRpId = "eulesia.org";
      cookieDomain = ".eulesia.org";
      cookieSecure = true;
      sessionSecretFile = config.sops.secrets."session-secret".path;
      meilisearch = {
        url = "http://127.0.0.1:7700";
        masterKeyFile = config.sops.secrets."meili-master-key".path;
      };
      idura = {
        enable = true;
        domain = "eulesia.idura.broker";
        clientId = "urn:my:application:identifier:524753";
        callbackUrl = "https://eulesia.org/api/v1/auth/ftn/callback";
        signingKeyFile =
          config.sops.secrets."idura-signing-key.jwk.json".path;
        encryptionKeyFile =
          config.sops.secrets."idura-encryption-key.jwk.json".path;
      };
      extraEnvironment = {
        APP_URL = "https://eulesia.org";
        API_URL = "https://eulesia.org";
      };
    };

    eulesia-jobs = {
      enable = true;
      package = eulesiaPackages.jobs;
      database.url = "postgresql:///eulesia_v2";
      extraEnvironment = {
        EULESIA_JOBS_LIPAS_ENABLED = "true";
        EULESIA_JOBS_OSM_ENABLED = "true";
      };
    };
  };

  environment.systemPackages = with pkgs; [
    curl
  ];

  system.stateVersion = "24.11";
}
