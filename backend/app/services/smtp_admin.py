"""Offline operator-only SMTP adoption/key rotation. No network sends or key output."""
import argparse
from uuid import UUID
from sqlalchemy import select
from .smtp_security import PREFIX, encrypt_secret, rotate_secret
from .smtp_categories import category_for
from . import security_audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['adopt', 'rotate'])
    parser.add_argument('--tenant', type=UUID, required=True)
    parser.add_argument('--profile-id')
    parser.add_argument('--primary', action='store_true')
    parser.add_argument('--apply', action='store_true', help='Apply explicit mapping/rotation; default is read-only')
    args = parser.parse_args()
    from ..database import SessionLocal
    from .. import models
    from ..tickets import models as ticket_models  # register existing ORM relationships
    with SessionLocal() as db:
        if args.operation == 'adopt':
            if not args.profile_id:
                parser.error('--profile-id is required for explicit adoption')
            model = models.SmtpConfig if args.primary else models.MultipleSmtpConfig
            row = db.scalar(select(model).where(model.id == (int(args.profile_id) if args.primary else args.profile_id)).with_for_update())
            if not row or row.tenant_id is not None and row.tenant_id != args.tenant:
                parser.error('Profile missing or already owned by another tenant')
            if not db.scalar(select(models.User.id).where(models.User.tenant_id == args.tenant)):
                parser.error('Tenant has no existing user; verify the approved mapping')
            if args.apply:
                row.tenant_id = args.tenant
                row.is_enabled = False
                row.notification_types = sorted(set(category_for(v) for v in row.notification_types or ['general']))
                if row.password:
                    row.password = rotate_secret(row.password) if row.password.startswith(PREFIX) else encrypt_secret(row.password)
                row.last_test_at = row.last_test_ok = row.last_test_code = None
                security_audit.append_event(db, actor=None, event_type='smtp.operator_adopted', entity_type='smtp',
                    entity_id=str(row.id), payload={'tenant_id': str(args.tenant), 'enabled': False})
                db.commit()
            print('Profile adoption ' + ('applied; profile remains disabled' if args.apply else 'validated; no changes made'))
        else:
            count = 0
            for model in (models.SmtpConfig, models.MultipleSmtpConfig):
                for row in db.scalars(select(model).where(model.tenant_id == args.tenant).with_for_update()):
                    if row.password:
                        rotated = rotate_secret(row.password)
                        if args.apply:
                            row.password = rotated
                        count += 1
            if args.apply:
                security_audit.append_event(db, actor=None, event_type='smtp.operator_rotated', entity_type='smtp',
                    entity_id=str(args.tenant), payload={'tenant_id': str(args.tenant), 'rotated_profiles': count})
                db.commit()
            print(f'Credentials checked: {count}; rotation ' + ('applied' if args.apply else 'not applied'))


if __name__ == '__main__':
    main()
