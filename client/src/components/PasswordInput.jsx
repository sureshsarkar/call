import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function PasswordInput({ className = 'input', ...inputProps }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input {...inputProps} type={visible ? 'text' : 'password'} className={`${className} pr-12`} />
      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-2 grid w-10 place-items-center rounded-lg text-mute transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {visible ? <EyeOff size={19} /> : <Eye size={19} />}
      </button>
    </div>
  );
}
