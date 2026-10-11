'use client';
import { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { loginWithPasskey, passkeySupported } from '@/lib/passkey-client';

export default function PasskeyButton() {
  const [supported, setSupported] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => setSupported(passkeySupported()), []);
  if (!supported) return null;
  return (
    <>
      <button
        type="button"
        className="button secondary full"
        disabled={busy}
        style={{ marginTop: 12 }}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await loginWithPasskey();
            location.href = '/';
          } catch (e) {
            const name = (e as Error).name;
            setError(name === 'NotAllowedError' ? 'Accesso con passkey annullato.' : (e as Error).message);
            setBusy(false);
          }
        }}
      >
        <Fingerprint size={17} /> Accedi con passkey
      </button>
      {error && (
        <p role="alert" className="notice error" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
    </>
  );
}
