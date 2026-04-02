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
  ];

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
    ];
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
        "api.eulesia.org".locations."/".extraConfig = ''
          proxy_set_header X-Forwarded-Proto $eulesia_forwarded_proto;
        '';

        "eulesia.org".locations = {
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

        "admin.eulesia.org".locations = {
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
            rule = "Host(`eulesia.org`)";
            service = "eulesia";
            entryPoints = ["websecure"];
            middlewares = [
              "security-headers"
            ];
            tls.certResolver = "letsencrypt";
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
  };

  environment.systemPackages = with pkgs; [
    curl
  ];

  system.stateVersion = "24.11";
}
