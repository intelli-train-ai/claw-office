import { cn } from '@/lib/utils';

interface SafeClawLogoProps {
  className?: string;
}

export function SafeClawLogo({ className }: SafeClawLogoProps) {
  return (
    <svg
      viewBox="-150 -150 300 300"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("rounded-full", className)}
    >
      {/* Background: gray in light, dark in dark mode */}
      <rect
        x="-150" y="-150" width="300" height="300"
        className="fill-[#e0e0e0] dark:fill-[#2a2a2a]"
      />

      <defs>
        <g id="safeclaw-cube">
          {/* Top Face */}
          <path
            d="M0,0 L0,-30 L25.98,-15 L25.98,15 Z"
            className="fill-[#e0e0e0] stroke-black dark:fill-[#2a2a2a] dark:stroke-white"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Left Face */}
          <path
            d="M0,0 L25.98,15 L0,30 L-25.98,15 Z"
            className="fill-[#e0e0e0] stroke-black dark:fill-[#2a2a2a] dark:stroke-white"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Right Face */}
          <path
            d="M0,0 L-25.98,15 L-25.98,-15 L0,-30 Z"
            className="fill-[#e0e0e0] stroke-black dark:fill-[#2a2a2a] dark:stroke-white"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>
      </defs>

      {/* Layer Z = -1 (Bottom) */}
      <use href="#safeclaw-cube" x="-25.98" y="15" />
      <use href="#safeclaw-cube" x="25.98"  y="15" />
      <use href="#safeclaw-cube" x="0"      y="30" />
      <use href="#safeclaw-cube" x="-25.98" y="45" />
      <use href="#safeclaw-cube" x="25.98"  y="45" />

      {/* Layer Z = 0 (Middle) */}
      <use href="#safeclaw-cube" x="0"      y="-30" />
      <use href="#safeclaw-cube" x="-25.98" y="-15" />
      <use href="#safeclaw-cube" x="25.98"  y="-15" />
      <use href="#safeclaw-cube" x="0"      y="0" />
      <use href="#safeclaw-cube" x="-51.96" y="0" />
      <use href="#safeclaw-cube" x="51.96"  y="0" />
      <use href="#safeclaw-cube" x="-25.98" y="15" />
      <use href="#safeclaw-cube" x="25.98"  y="15" />
      <use href="#safeclaw-cube" x="0"      y="30" />

      {/* Layer Z = 1 (Top) */}
      <use href="#safeclaw-cube" x="-25.98" y="-45" />
      <use href="#safeclaw-cube" x="25.98"  y="-45" />
      <use href="#safeclaw-cube" x="0"      y="-30" />
      <use href="#safeclaw-cube" x="-25.98" y="-15" />
      <use href="#safeclaw-cube" x="25.98"  y="-15" />
    </svg>
  );
}
