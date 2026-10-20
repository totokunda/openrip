import React, { useId } from "react";

/** The torn play mark's two sides (buildResources/icon.svg is the same drawing, the app icon's source). */
const LEFT = "0,0 566,0 580,45 551,89 581,134 541,178 567,223 536,267 568,312 542,356 572,401 535,445 559,490 523,534 561,579 530,623 556,668 518,712 546,757 519,801 553,846 519,890 543,935 510,979 526,1024 0,1024";
const RIGHT = "1024,0 1024,1024 526,1024 510,979 543,935 519,890 553,846 519,801 546,757 518,712 556,668 530,623 561,579 523,534 559,490 535,445 572,401 542,356 568,312 536,267 567,223 541,178 581,134 551,89 580,45 566,0";
const TRIANGLE = "M376 296 L376 728 L752 512 Z";

/**
 * OpenRip's logo: a play triangle torn in two on a dark rounded tile, in the app's lavender. The
 * same drawing as the app icon (buildResources/icon.svg); ids are per instance, so several can
 * be on screen at once.
 */
const AppLogo: React.FC<{ size?: number; className?: string; title?: string }> = ({ size = 64, className, title = "OpenRip" }) => {
  const id = useId().replace(/:/g, "");
  const ref = (name: string) => `url(#${name}-${id})`;
  return (
    <svg viewBox="100 100 824 824" width={size} height={size} className={className} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`bg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e2738" />
          <stop offset="1" stopColor="#131117" />
        </linearGradient>
        <linearGradient id={`left-${id}`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#d4b4ef" />
          <stop offset="1" stopColor="#9563c2" />
        </linearGradient>
        <linearGradient id={`right-${id}`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#eddcfb" />
          <stop offset="1" stopColor="#b487db" />
        </linearGradient>
        <clipPath id={`lh-${id}`}>
          <polygon points={LEFT} />
        </clipPath>
        <clipPath id={`rh-${id}`}>
          <polygon points={RIGHT} />
        </clipPath>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="186" fill={ref("bg")} />
      <rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="3" />
      <g clipPath={ref("lh")}>
        <path d={TRIANGLE} fill={ref("left")} stroke={ref("left")} strokeWidth="68" strokeLinejoin="round" />
      </g>
      <g transform="translate(24 -12) rotate(2.5 560 512)">
        <g clipPath={ref("rh")}>
          <path d={TRIANGLE} fill={ref("right")} stroke={ref("right")} strokeWidth="68" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
  );
};

export default AppLogo;
