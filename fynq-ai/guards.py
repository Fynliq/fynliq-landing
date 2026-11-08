"""Input guards for the FYNQ AI inference server. Standard library only, so they
can be tested without torch or a GPU."""
import hmac
import re

# A US Social Security number: 123-45-6789, 123 45 6789 or 123456789.
SSN_PATTERN = re.compile(r"\b\d{3}[- ]?\d{2}[- ]?\d{4}\b")


def contains_ssn(text: str) -> bool:
    return bool(SSN_PATTERN.search(text or ""))


def bearer_matches(authorization: str, secret: str) -> bool:
    """Constant-time check of an `Authorization: Bearer <secret>` header.
    Always False when no secret is configured."""
    if not secret:
        return False
    return hmac.compare_digest((authorization or "").encode(), ("Bearer " + secret).encode())
