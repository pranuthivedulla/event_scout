'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * A button that sends a circular ripple out from wherever you clicked it.
 *
 * Same behaviour as MagicUI's ripple-button: on click a circle is placed at
 * the pointer, sized to cover the button, then scaled up while fading out and
 * removed when the animation ends.
 */

interface Ripple {
  key: number;
  x: number;
  y: number;
  size: number;
}

export function RippleButton({
  children,
  onClick,
  className = '',
  rippleColor = 'rgba(255,255,255,0.55)',
  duration = 600,
  active = false,
  ariaPressed,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  rippleColor?: string;
  duration?: number;
  active?: boolean;
  ariaPressed?: boolean;
  title?: string;
}) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const seq = useRef(0);

  const spawn = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // cover the whole button from wherever the pointer landed
    const size = Math.max(rect.width, rect.height) * 2;
    const key = ++seq.current;
    setRipples((r) => [...r, { key, x: e.clientX - rect.left, y: e.clientY - rect.top, size }]);
    window.setTimeout(() => {
      setRipples((r) => r.filter((x) => x.key !== key));
    }, duration);
  }, [duration]);

  return (
    <button
      type="button"
      title={title}
      aria-pressed={ariaPressed}
      className={`ripple-btn ${active ? 'is-active' : ''} ${className}`}
      onClick={(e) => { spawn(e); onClick?.(); }}
    >
      <span className="ripple-content">{children}</span>
      {ripples.map((r) => (
        <span
          key={r.key}
          className="ripple"
          aria-hidden
          style={{
            left: r.x - r.size / 2,
            top: r.y - r.size / 2,
            width: r.size,
            height: r.size,
            background: rippleColor,
            animationDuration: `${duration}ms`,
          }}
        />
      ))}
    </button>
  );
}
