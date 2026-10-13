import React, { useState, useEffect, useRef, Fragment } from "react";
import {
  detectState,
  getLocalTime,
  getCallAdvice,
  getNextBestTime,
} from "../../utils/timeLogic";
import { stateTimezones } from "../../utils/timezoneMap";
import { ArrowPathIcon, ChevronUpDownIcon } from "@heroicons/react/24/outline";
import { motion, AnimatePresence } from "framer-motion";
import Lottie from "lottie-react";
import assistantAnimation from "./character.json";
import { Listbox, Transition } from "@headlessui/react";

const ClockDropdown = ({ selectedCountry, is12Hour, onClose }) => {
  const [form, setForm] = useState({
    state: "",
    areaCode: "",
    phone: "",
    zip: "",
  });
  const [result, setResult] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef(null);

  // ✅ Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        if (onClose) onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // ✅ Auto-update when user inputs anything
  useEffect(() => {
    if (selectedCountry !== "United States") {
      setResult(null);
      return;
    }

    const state = detectState(form);
    if (!state || !stateTimezones[state]) {
      setResult(null);
      return;
    }

    const timeString = getLocalTime(state, is12Hour);
    const hour = new Date().toLocaleString("en-US", {
      timeZone: stateTimezones[state],
      hour: "2-digit",
      hour12: false,
    });

    const advice = getCallAdvice(parseInt(hour));
    const next = getNextBestTime(parseInt(hour));

    setResult({
      state,
      time: timeString,
      timezone: stateTimezones[state],
      ...advice,
      ...next,
    });
  }, [form, selectedCountry, is12Hour]);

  // ✅ Reset / Refresh
  const handleRefresh = () => {
    setForm({ state: "", areaCode: "", phone: "", zip: "" });
    setResult(null);
  };

  return (
    <AnimatePresence>
      <motion.div
        ref={dropdownRef}
        className="inner-border"
        initial={{ opacity: 0, y: -10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.96 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        {/* Character Animation */}
        <motion.div
          className="flex justify-center mb-4"
          initial={{ scale: 2, opacity: 0 }}
          animate={{ scale: 1.5, opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <Lottie animationData={assistantAnimation} loop style={{ width: 140, height: 140 }} />
        </motion.div>

        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold tracking-tight flex items-center gap-2 text-[var(--theme-text)] dark:text-white colorful:gradient-text">
            <span className="text-[var(--theme-accent)]">🕒</span> Smart Clock Assistant
          </h3>
          <motion.button
            onClick={handleRefresh}
            whileHover={{ rotate: 180, scale: 1.1 }}
            transition={{ type: "spring", stiffness: 200 }}
            className="p-1 bg-[var(--theme-border)]/30 hover:bg-[var(--theme-border)]/60 rounded-full"
          >
            <ArrowPathIcon className="w-5 h-5 text-[var(--theme-accent)]" />
          </motion.button>
        </div>

        {/* Input Section */}
        {selectedCountry === "United States" ? (
          <>
            <div className="grid grid-cols-2 gap-3 mb-3">
              {/* State Dropdown with Search */}
              <Listbox
                value={form.state}
                onChange={(value) => setForm({ ...form, state: value })}
              >
                <div className="relative col-span-2">
                  <Listbox.Button
                    className="relative w-full p-2 bg-transparent border border-[var(--theme-border)]
                    rounded-xl text-sm focus:ring-2 focus:ring-[var(--theme-accent)]
                    focus:outline-none text-[var(--theme-text)] text-left
                    dark:border-white dark:text-white colorful:gradient-border"
                  >
                    <span className="block truncate">
                      {form.state || "Select State"}
                    </span>
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                      <ChevronUpDownIcon
                        className="h-5 w-5 text-gray-400"
                        aria-hidden="true"
                      />
                    </span>
                  </Listbox.Button>

                  {/* Dropdown */}
                  <Transition
                    as={Fragment}
                    leave="transition ease-in duration-100"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                  >
                    <Listbox.Options
                      className="absolute z-10 mt-1 max-h-52 w-full overflow-auto
                      rounded-md bg-white dark:bg-gray-800 py-1 text-base shadow-lg
                      ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
                    >
                      {/* Search box */}
                      <div className="p-2 sticky top-0 bg-white dark:bg-gray-800">
                        <input
                          type="text"
                          placeholder="Search State..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full p-2 border border-gray-300 dark:border-gray-600
                          rounded text-sm focus:ring-2 focus:ring-[var(--theme-accent)]
                          focus:outline-none text-gray-900 dark:text-white"
                        />
                      </div>

                      {/* Filtered states */}
                      {Object.keys(stateTimezones)
                        .filter((s) =>
                          s.toLowerCase().includes(searchTerm.toLowerCase())
                        )
                        .slice(0, 50) // Limit for performance
                        .map((s) => (
                          <Listbox.Option
                            key={s}
                            value={s}
                            className={({ active }) =>
                              `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                active
                                  ? "bg-[var(--theme-accent)] text-white"
                                  : "text-gray-900 dark:text-white"
                              }`
                            }
                          >
                            {({ selected }) => (
                              <>
                                <span
                                  className={`block truncate ${
                                    selected ? "font-medium" : "font-normal"
                                  }`}
                                >
                                  {s}
                                </span>
                                {selected && (
                                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--theme-accent)]">
                                    <svg
                                      className="h-5 w-5"
                                      viewBox="0 0 20 20"
                                      fill="currentColor"
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                  </span>
                                )}
                              </>
                            )}
                          </Listbox.Option>
                        ))}
                    </Listbox.Options>
                  </Transition>
                </div>
              </Listbox>

              {/* Area Code */}
              <input
                type="text"
                placeholder="Area Code (e.g. 415)"
                value={form.areaCode}
                onChange={(e) => setForm({ ...form, areaCode: e.target.value })}
                className="p-2 bg-transparent border border-[var(--theme-border)]
                rounded-xl text-sm focus:ring-2 focus:ring-[var(--theme-accent)]
                focus:outline-none placeholder-gray-400 text-[var(--theme-text)]
                dark:border-white dark:text-white colorful:gradient-border"
              />

              {/* Phone Number */}
              <input
                type="text"
                placeholder="Phone Number (e.g. 4155551234)"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="p-2 bg-transparent border border-[var(--theme-border)]
                rounded-xl text-sm focus:ring-2 focus:ring-[var(--theme-accent)]
                focus:outline-none placeholder-gray-400 text-[var(--theme-text)]
                dark:border-white dark:text-white colorful:gradient-border"
              />

              {/* ZIP Code */}
              <input
                type="text"
                placeholder="ZIP Code (optional)"
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
                className="p-2 bg-transparent border border-[var(--theme-border)]
                rounded-xl text-sm focus:ring-2 focus:ring-[var(--theme-accent)]
                focus:outline-none placeholder-gray-400 text-[var(--theme-text)]
                dark:border-white dark:text-white colorful:gradient-border"
              />
            </div>

            {/* Results */}
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-3 p-4 rounded-xl border border-[var(--theme-border)]
                bg-white dark:bg-gray-900 shadow-inner text-[var(--theme-text)]"
              >
                <h4 className="text-sm font-semibold text-[var(--theme-accent)] mb-2 uppercase">
                  Results
                </h4>
                <div className="space-y-1 text-sm">
                  <p>📍 <b>State:</b> {result.state}</p>
                  <p>⏰ <b>Local Time:</b> <span className="text-[var(--theme-accent)]">{result.time}</span></p>
                  <p>📞 <b>Cold Call Window:</b> {result.cold ? "✅ Yes" : "❌ No"}</p>
                  <p>🏢 <b>B2B Call Window:</b> {result.b2b ? "✅ Yes" : "❌ No"}</p>
                  <p>💡 <i>{result.tip}</i></p>
                  {result.nextTime && (
                    <p className="text-[var(--theme-accent)]">
                      ⏭️ <b>Next Best Time:</b> {result.nextTime} — {result.note}
                    </p>
                  )}
                </div>

                {/* Progress Bar */}
                <div className="mt-4 relative h-2 w-full bg-[var(--theme-border)]/30 rounded-full overflow-hidden">
                  <motion.div
                    className="absolute top-0 left-0 h-full rounded-full bg-[var(--theme-accent)]"
                    initial={{ width: 0 }}
                    animate={{
                      width: result.cold || result.b2b ? "85%" : "25%",
                    }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
              </motion.div>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-400 italic text-center">
            🌎 This feature is only available for the United States.
          </p>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default ClockDropdown;
