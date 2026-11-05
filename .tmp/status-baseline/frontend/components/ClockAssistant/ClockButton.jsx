import React, { lazy, Suspense, useRef, useState } from "react";
import { Clock } from "lucide-react";
const ClockDropdown = lazy(() => import("./ClockDropdown"));

const ClockButton = ({ selectedCountry, is12Hour, theme }) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

  const themeClasses =
    theme === "dark"
      ? "bg-slate-800 text-white border border-slate-700"
      : theme === "colorful"
      ? "bg-gradient-to-r from-fuchsia-500 via-sky-400 to-violet-500 text-black"
      : "bg-white text-gray-900 border border-gray-300";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open clock assistant"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="p-2 rounded-full hover:bg-white/20 transition"
      >
        <Clock className="w-5 h-5" />
      </button>

      {open && <div className={`zea-clock-popup absolute right-0 mt-2 w-96 rounded-2xl shadow-xl p-4 z-50 ${themeClasses}`}>
        <Suspense fallback={<span role="status">Loading clock assistant...</span>}>
          <ClockDropdown selectedCountry={selectedCountry} is12Hour={is12Hour} theme={theme} triggerRef={triggerRef} onClose={() => setOpen(false)} />
        </Suspense>
      </div>}
    </div>
  );
};

export default ClockButton;
