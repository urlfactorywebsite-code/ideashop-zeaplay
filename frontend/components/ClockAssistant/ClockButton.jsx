import React, { useState } from "react";
import { Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ClockDropdown from "./ClockDropdown";

const ClockButton = ({ selectedCountry, is12Hour, theme }) => {
  const [open, setOpen] = useState(false);

  const themeClasses =
    theme === "dark"
      ? "bg-slate-800 text-white border border-slate-700"
      : theme === "colorful"
      ? "bg-gradient-to-r from-fuchsia-500 via-sky-400 to-violet-500 text-black"
      : "bg-white text-gray-900 border border-gray-300";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-full hover:bg-white/20 transition"
      >
        <Clock className="w-5 h-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className={`absolute right-0 mt-2 w-96 rounded-2xl shadow-xl p-4 z-50 ${themeClasses}`}
          >
            <ClockDropdown
              selectedCountry={selectedCountry}
              is12Hour={is12Hour}
              theme={theme}
              onClose={() => setOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ClockButton;
