{
  pkgs ? import <nixpkgs> { },
}:

pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs_20
    pkgs.nodePackages.npm
    pkgs.nodePackages.typescript
    pkgs.nodePackages.typescript-language-server
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
}
