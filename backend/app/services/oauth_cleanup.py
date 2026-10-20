"""Bounded retention cleanup. Never prune replay evidence for a live grant.

Dry run by default. Audit events and client registrations are retained.
"""
import argparse
import json

from sqlalchemy import delete, exists, or_, select

from ..config import get_settings

if __name__ == '__main__' and get_settings().bootstrap_schema:
    raise SystemExit('Set VEE_BOOTSTRAP_SCHEMA=false before running OAuth cleanup')

from ..database import SessionLocal
from ..oauth_models import (
    BrowserSession,
    OAuthCode,
    OAuthConsent,
    OAuthGrant,
    OAuthToken,
    epoch,
)


def cleanup(db, apply=False, batch_size=1000, grace_days=7):
    if not 1 <= batch_size <= 10000 or grace_days < 1:
        raise ValueError('Use batch size 1..10000 and grace of at least one day')
    cutoff = epoch() - grace_days * 86400
    old_grants = select(OAuthGrant.id).where(or_(OAuthGrant.expires_at < cutoff, OAuthGrant.revoked_at < cutoff)).limit(batch_size)
    if apply:
        old_grants = old_grants.with_for_update(skip_locked=True)
    grants = list(db.scalars(old_grants))
    tokens = list(db.scalars(select(OAuthToken.id).where(OAuthToken.grant_id.in_(grants)).limit(batch_size)))
    codes = list(db.scalars(select(OAuthCode.verifier).where(OAuthCode.grant_id.in_(grants)).limit(batch_size)))
    consents = list(db.scalars(select(OAuthConsent.verifier).where(OAuthConsent.expires_at < cutoff).limit(batch_size)))
    sessions = list(db.scalars(select(BrowserSession.verifier).where(or_(BrowserSession.expires_at < cutoff, BrowserSession.revoked_at < cutoff)).limit(batch_size)))
    result = dict(apply=apply, batch_size=batch_size, grace_days=grace_days,
        tokens=len(tokens), codes=len(codes), consents=len(consents), browser_sessions=len(sessions), grants=0)
    if apply:
        db.execute(delete(OAuthToken).where(OAuthToken.id.in_(tokens)))
        db.execute(delete(OAuthCode).where(OAuthCode.verifier.in_(codes)))
        db.execute(delete(OAuthConsent).where(OAuthConsent.verifier.in_(consents)))
        db.execute(delete(BrowserSession).where(BrowserSession.verifier.in_(sessions)))
        # A large family can take multiple batches. Never delete its parent early.
        result['grants'] = db.execute(delete(OAuthGrant).where(OAuthGrant.id.in_(grants),
            ~exists().where(OAuthToken.grant_id == OAuthGrant.id),
            ~exists().where(OAuthCode.grant_id == OAuthGrant.id))).rowcount
    else:
        result['grant_candidates'] = len(grants)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--batch-size', type=int, default=1000)
    parser.add_argument('--grace-days', type=int, default=7)
    arguments = parser.parse_args()
    with SessionLocal.begin() as db:
        result = cleanup(db, **vars(arguments))
    print(json.dumps(result))
