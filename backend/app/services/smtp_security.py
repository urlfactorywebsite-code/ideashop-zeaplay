"""SMTP secret envelopes and pinned, verified outbound connections."""
from contextlib import contextmanager
from email.message import EmailMessage
from email.policy import SMTP as SMTP_POLICY
from email.utils import formataddr
import ipaddress
import re
import smtplib
import socket
import ssl

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from ..config import get_settings

PREFIX = "smtp:v1:"


class SmtpError(RuntimeError):
    def __init__(self, code, *, retryable=False, uncertain=False, retry_at=None):
        if code not in {'configuration', 'key_unavailable', 'destination_blocked', 'dns_failure', 'authentication_failed',
                        'tls_failure', 'timeout', 'connection_rejected', 'sender_rejected', 'recipient_rejected',
                        'temporary_failure', 'permanent_failure', 'acceptance_unknown', 'rate_limited', 'oauth_unsupported', 'delivery_disabled'}:
            code, retryable, uncertain = 'acceptance_unknown', False, True
        self.code = code
        self.retryable = retryable
        self.uncertain = uncertain
        self.retry_at = retry_at if code == 'rate_limited' else None
        super().__init__({
            "configuration": "SMTP configuration is incomplete or unavailable.",
            "key_unavailable": "SMTP encryption keys are unavailable or cannot decrypt this credential.",
            "destination_blocked": "SMTP destination is blocked by server policy.",
            "dns_failure": "SMTP host could not be resolved.",
            "authentication_failed": "SMTP authentication failed. Check provider credentials and authentication policy.",
            "tls_failure": "TLS negotiation or certificate verification failed.",
            "timeout": "SMTP connection timed out before message submission.",
            "connection_rejected": "SMTP connection could not be established.",
            "sender_rejected": "SMTP server rejected the sender identity.",
            "recipient_rejected": "SMTP server rejected the recipient.",
            "temporary_failure": "SMTP server temporarily rejected the message.",
            "permanent_failure": "SMTP server permanently rejected the message.",
            "acceptance_unknown": "SMTP acceptance is uncertain. Automatic resend is disabled to avoid duplicates.",
            "rate_limited": "SMTP profile rate limit or daily quota reached.",
            "oauth_unsupported": "SMTP OAuth is not integrated. Configure an approved SMTP relay instead.",
            "delivery_disabled": "SMTP delivery is disabled by server policy.",
        }.get(code, "SMTP operation failed."))


def keyring():
    try:
        keys = get_settings().smtp_secret_keys
        if not keys:
            raise ValueError()
        return MultiFernet([Fernet(value.encode()) for value in keys])
    except (ValueError, TypeError):
        raise SmtpError("key_unavailable") from None


def encrypt_secret(secret):
    return PREFIX + keyring().encrypt(secret.encode()).decode()


def decrypt_secret(secret):
    if not secret or not secret.startswith(PREFIX):
        raise SmtpError("key_unavailable")
    try:
        return keyring().decrypt(secret[len(PREFIX):].encode()).decode()
    except (InvalidToken, ValueError, UnicodeError):
        raise SmtpError("key_unavailable") from None


def rotate_secret(secret):
    if not secret or not secret.startswith(PREFIX):
        raise SmtpError("key_unavailable")
    try:
        return PREFIX + keyring().rotate(secret[len(PREFIX):].encode()).decode()
    except InvalidToken:
        raise SmtpError("key_unavailable") from None


def canonical_host(value):
    if not isinstance(value, str) or not value or value != value.strip() or any(c in value for c in "\r\n/@#?%\\"):
        raise ValueError("Enter a hostname or IP address without a scheme, path or port")
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        try:
            host = value.rstrip('.').encode('idna').decode().lower()
        except UnicodeError:
            raise ValueError("Invalid SMTP host") from None
        if len(host) > 253 or '.' not in host or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part) for part in host.split('.')):
            raise ValueError("Invalid SMTP host")
        return host


def policy_name(host, port):
    return f"[{host}]:{port}" if ':' in host else f"{host}:{port}"


def resolve_destination(host, port):
    host = canonical_host(host)
    approved = policy_name(host, port) in get_settings().smtp_private_host_allowlist
    try:
        records = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        raise SmtpError("dns_failure", retryable=True) from None
    if not records:
        raise SmtpError("dns_failure", retryable=True)
    for _, _, _, _, address in records:
        ip = ipaddress.ip_address(address[0])
        ip = getattr(ip, 'ipv4_mapped', None) or ip
        effective = [ip]
        if ip.version == 6:
            # Translators can route globally classified IPv6 to a private IPv4
            # destination. Validate the embedded addresses as well as the socket IP.
            if ip in ipaddress.ip_network('64:ff9b::/96') or ip in ipaddress.ip_network('::/96'):
                effective.append(ipaddress.IPv4Address(int(ip) & 0xffffffff))
            if ip.sixtofour:
                effective.append(ip.sixtofour)
            if ip.teredo:
                effective.extend(ip.teredo)
            if ip in ipaddress.ip_network('64:ff9b:1::/48') and not approved:
                raise SmtpError('destination_blocked')
        for destination in effective:
            if destination.is_link_local or destination.is_multicast or destination.is_unspecified or (not destination.is_global and not approved):
                raise SmtpError("destination_blocked")
    return host, list(dict.fromkeys((family, address) for family, _, _, _, address in records))


def tls_context():
    try:
        context = ssl.create_default_context(cafile=get_settings().smtp_ca_file)
    except (OSError, ssl.SSLError):
        raise SmtpError('tls_failure') from None
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context


@contextmanager
def open_client(config):
    if not get_settings().smtp_delivery_enabled:
        raise SmtpError("delivery_disabled")
    auth = getattr(config, 'auth_method', 'password')
    if auth == 'oauth2':
        raise SmtpError('oauth_unsupported')
    secret = decrypt_secret(config.password) if auth == 'password' else None
    host, records = resolve_destination(config.host, config.port)
    mode = config.encryption.lower()
    if mode not in {"tls", "ssl", "none"}:
        raise SmtpError("configuration")
    if mode == 'none' and policy_name(host, config.port) not in get_settings().smtp_plaintext_host_allowlist:
        raise SmtpError("destination_blocked")
    context = tls_context()

    def pinned_socket(_self, _host, _port, timeout):
        last_error = None
        for family, address in records:
            sock = socket.socket(family, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            try:
                sock.connect(address)
                if ipaddress.ip_address(sock.getpeername()[0]) != ipaddress.ip_address(address[0]):
                    raise SmtpError("destination_blocked")
                return context.wrap_socket(sock, server_hostname=host) if mode == 'ssl' else sock
            except Exception as exc:
                sock.close()
                last_error = exc
        raise last_error

    cls = type('PinnedSMTP', (smtplib.SMTP_SSL if mode == 'ssl' else smtplib.SMTP,), {'_get_socket': pinned_socket})
    client = None
    try:
        options = {'timeout': 15}
        if mode == 'ssl':
            options['context'] = context
        client = cls(host, config.port, **options)
        if client.ehlo()[0] != 250:
            raise SmtpError('connection_rejected', retryable=True)
        if mode == 'tls':
            client.starttls(context=context)
            if client.ehlo()[0] != 250:
                raise SmtpError('connection_rejected', retryable=True)
        if auth == 'password':
            try:
                client.login(config.username, secret)
            except smtplib.SMTPNotSupportedError:
                raise SmtpError('authentication_failed') from None
        elif auth != 'none' or policy_name(host, config.port) not in get_settings().smtp_private_host_allowlist:
            raise SmtpError('configuration')
        yield client
    except SmtpError:
        raise
    except smtplib.SMTPAuthenticationError:
        raise SmtpError('authentication_failed') from None
    except (ssl.SSLError, smtplib.SMTPNotSupportedError):
        raise SmtpError('tls_failure') from None
    except (TimeoutError, socket.timeout):
        raise SmtpError('timeout', retryable=True) from None
    except (OSError, smtplib.SMTPException):
        raise SmtpError('connection_rejected', retryable=True) from None
    finally:
        # A QUIT failure after a successful DATA reply must not turn acceptance into a retry.
        if client is not None:
            try:
                client.close()
            except Exception:
                pass


def transport(config, *, recipient=None, subject=None, body=None, message_id=None):
    with open_client(config) as client:
        if recipient is None:
            return
        message = EmailMessage()
        sender = getattr(config, 'sender_email', None) or config.username
        message['From'] = formataddr((getattr(config, 'sender_name', None) or '', sender))
        message['To'] = recipient
        message['Subject'] = subject
        if getattr(config, 'reply_to', None):
            message['Reply-To'] = config.reply_to
        if message_id:
            message['Message-ID'] = message_id
        message.set_content(body)
        # Explicit SMTP phases distinguish pre-DATA failure from uncertain acceptance.
        try:
            code, _ = client.mail(sender)
            if code != 250:
                raise SmtpError('sender_rejected', retryable=400 <= code < 500)
            code, _ = client.rcpt(recipient)
            if code not in {250, 251, 252}:
                raise SmtpError('recipient_rejected', retryable=400 <= code < 500)
        except SmtpError:
            raise
        except (OSError, smtplib.SMTPException):
            raise SmtpError('connection_rejected', retryable=True) from None
        try:
            code, _ = client.data(message.as_bytes(policy=SMTP_POLICY))
            if code != 250:
                raise SmtpError('temporary_failure' if 400 <= code < 500 else 'permanent_failure', retryable=400 <= code < 500)
        except SmtpError:
            raise
        except smtplib.SMTPDataError as exc:
            raise SmtpError('temporary_failure' if 400 <= exc.smtp_code < 500 else 'permanent_failure', retryable=400 <= exc.smtp_code < 500) from None
        except (OSError, smtplib.SMTPException):
            raise SmtpError('acceptance_unknown', uncertain=True) from None
