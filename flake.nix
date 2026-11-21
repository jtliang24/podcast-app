{
  description = "Podcast App dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forEachSupportedSystem = f:
        nixpkgs.lib.genAttrs supportedSystems (system:
          f {
            pkgs = import nixpkgs { inherit system; };
          });
    in
    {
      devShells = forEachSupportedSystem ({ pkgs }: {
        default = pkgs.mkShell {
          packages = [
            pkgs.zulu
            pkgs.nodejs
            pkgs.typescript
            pkgs.typescript-language-server
            pkgs.tailwindcss
          ];

          shellHook = ''
            echo "⚡ Podcast App Dev Environment"

            # Automatically install npm dependencies if node_modules doesn't exist
            if [ ! -d "node_modules" ]; then
              echo "📦 node_modules not found. Installing..."
              npm install
            fi

            # Add node_modules binaries to PATH
            export PATH="$PWD/node_modules/.bin:$PATH"

            echo "✅ Environment ready. Run 'npm run start-app' to start."
          '';
        };
      });
    };
}
