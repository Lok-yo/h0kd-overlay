pkgname=h0kd-overlay
pkgver=0.2.9
pkgrel=1
pkgdesc='Self-hosted Twitch Channel Points video overlay'
arch=('x86_64')
url='https://github.com/h0kd/h0kd-overlay'
license=('MIT')
depends=(
  'gcc-libs'
  'glibc'
  'gtk3'
  'webkit2gtk-4.1'
  'xdg-utils'
)
makedepends=('cargo')
options=('!lto')
source=("$pkgname-$pkgver.tar.gz::$url/archive/refs/tags/v$pkgver.tar.gz")
sha256sums=('d32c9adfd77fd335d11ef99d323be07130c207b706712b7c8ec11f8a9ce16e41')

prepare() {
  cd "$pkgname-$pkgver/src-tauri"
  # The desktop binary only needs the Rust library target. Building every crate
  # type prevents ring's native archive from reaching the final link on Rust 1.97.
  sed -i 's/crate-type = \["staticlib", "cdylib", "rlib"\]/crate-type = ["rlib"]/' Cargo.toml

  export RUSTUP_TOOLCHAIN=stable
  cargo fetch --locked --target x86_64-unknown-linux-gnu
}

build() {
  cd "$pkgname-$pkgver/src-tauri"
  export RUSTUP_TOOLCHAIN=stable
  export CARGO_TARGET_DIR=target
  # Rust 1.97 LTO drops ring's native archive while linking this local library.
  export CARGO_PROFILE_RELEASE_LTO=false
  export RUSTFLAGS="${RUSTFLAGS:-} -C linker-features=-lld"
  cargo build --frozen --release --bins --features tauri/custom-protocol
}

check() {
  cd "$pkgname-$pkgver/src-tauri"
  export RUSTUP_TOOLCHAIN=stable
  export CARGO_TARGET_DIR=target
  export RUSTFLAGS="${RUSTFLAGS:-} -C linker-features=-lld"
  cargo test --frozen --features tauri/custom-protocol
}

package() {
  cd "$pkgname-$pkgver"

  install -Dm0755 \
    'src-tauri/target/release/stream-overlay' \
    "$pkgdir/usr/bin/stream-overlay"

  install -Dm0644 \
    'src-tauri/icons/128x128.png' \
    "$pkgdir/usr/share/icons/hicolor/128x128/apps/stream-overlay.png"
  install -Dm0644 \
    'src-tauri/icons/128x128@2x.png' \
    "$pkgdir/usr/share/icons/hicolor/256x256/apps/stream-overlay.png"

  install -Dm0644 LICENSE \
    "$pkgdir/usr/share/licenses/$pkgname/LICENSE"

  install -Dm0644 /dev/stdin \
    "$pkgdir/usr/share/applications/stream-overlay.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Stream Overlay
Comment=Twitch Channel Points video overlay
Exec=stream-overlay
Icon=stream-overlay
Terminal=false
Categories=AudioVideo;Utility;
EOF
}
