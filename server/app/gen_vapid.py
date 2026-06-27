"""One-shot VAPID keypair generator for Web Push.

Run once on the server (or anywhere with the deps installed):

    cd server && python -m app.gen_vapid

It prints three lines ready to paste into the server `.env`:

    VAPID_PUBLIC_KEY=...      (base64url applicationServerKey for the browser)
    VAPID_PRIVATE_KEY=...     (base64url raw EC private key for signing)
    VAPID_SUBJECT=mailto:...  (edit to your contact address)

Keep the private key secret. Changing it later invalidates every existing
browser subscription (clients re-subscribe automatically on next launch).
"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def main() -> None:
    key = ec.generate_private_key(ec.SECP256R1())

    # Private: the raw 32-byte scalar, base64url — the form pywebpush accepts
    # directly as vapid_private_key.
    priv_int = key.private_numbers().private_value
    priv_raw = priv_int.to_bytes(32, "big")
    private_b64 = _b64url(priv_raw)

    # Public: the uncompressed point (65 bytes, 0x04 prefix), base64url — this
    # is the applicationServerKey the browser's pushManager.subscribe() needs.
    pub_raw = key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    public_b64 = _b64url(pub_raw)

    print(f"VAPID_PUBLIC_KEY={public_b64}")
    print(f"VAPID_PRIVATE_KEY={private_b64}")
    print("VAPID_SUBJECT=mailto:admin@gandola.chat")


if __name__ == "__main__":
    main()
