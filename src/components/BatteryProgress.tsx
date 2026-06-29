import { motion, AnimatePresence } from "framer-motion";
import { Zap } from "lucide-react";
import { useEffect, useState } from "react";

interface BatteryProgressProps {
  visible: boolean;
  progress: number; // 0-100
  label?: string;
}

export function BatteryProgress({ visible, progress, label }: BatteryProgressProps) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);


  // iOS-like color logic: red < 20, green when charging, white at full
  const fillColor =
    pct >= 100
      ? "oklch(0.78 0.17 150)"
      : pct < 20
      ? "oklch(0.68 0.22 25)"
      : "oklch(0.78 0.17 150)";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.96 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          dir="rtl"
          className="pointer-events-none fixed bottom-8 left-1/2 z-[100] -translate-x-1/2"
        >
          <div
            className="pointer-events-auto flex items-center gap-4 rounded-[28px] px-6 py-4 shadow-2xl backdrop-blur-xl"
            style={{
              background: isDark
                ? "linear-gradient(180deg, oklch(0.18 0.01 270 / 0.92), oklch(0.12 0.01 270 / 0.92))"
                : "linear-gradient(180deg, oklch(1 0 0 / 0.92), oklch(0.97 0.005 260 / 0.92))",
              border: isDark
                ? "1px solid oklch(1 0 0 / 0.1)"
                : "1px solid oklch(0 0 0 / 0.08)",
              boxShadow: isDark
                ? "0 20px 60px -15px oklch(0 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.08)"
                : "0 20px 60px -15px oklch(0 0 0 / 0.18), inset 0 1px 0 oklch(1 0 0 / 0.6)",
            }}
          >
            {/* Label */}
            <div className="flex flex-col items-end gap-1">
              <span
                className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: isDark ? "oklch(1 0 0 / 0.5)" : "oklch(0.4 0.02 260 / 0.7)" }}
              >
                {label ?? "בונה תסריטים"}
              </span>
              <span
                className="text-2xl font-semibold tabular-nums"
                style={{ color: isDark ? "oklch(1 0 0)" : "oklch(0.2 0.02 260)" }}
              >
                {pct}%
              </span>
            </div>

            {/* iOS Battery */}
            <div className="flex items-center">
              <div
                className="relative h-[44px] w-[88px] rounded-[10px] p-[3px]"
                style={{
                  border: isDark
                    ? "2.5px solid oklch(1 0 0 / 0.35)"
                    : "2.5px solid oklch(0 0 0 / 0.25)",
                }}
              >
                {/* Fill */}
                <div className="relative h-full w-full overflow-hidden rounded-[6px]">
                  <motion.div
                    className="absolute inset-y-0 right-0 rounded-[6px]"
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    style={{
                      background: `linear-gradient(180deg, ${fillColor}, color-mix(in oklab, ${fillColor} 80%, black))`,
                      boxShadow: `0 0 12px ${fillColor}, inset 0 1px 0 oklch(1 0 0 / 0.25)`,
                    }}
                  />
                  {/* Charging shimmer */}
                  {pct < 100 && (
                    <motion.div
                      className="absolute inset-y-0 w-[40%]"
                      style={{
                        background:
                          "linear-gradient(90deg, transparent, oklch(1 0 0 / 0.25), transparent)",
                      }}
                      animate={{ x: ["-100%", "300%"] }}
                      transition={{
                        duration: 1.6,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    />
                  )}
                  {/* Charging bolt overlay */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Zap
                      className="h-5 w-5 fill-white text-white drop-shadow"
                      strokeWidth={1.5}
                    />
                  </div>
                </div>
              </div>
              {/* Battery cap */}
              <div
                className="h-[16px] w-[4px] rounded-r-[2px]"
                style={{
                  background: isDark ? "oklch(1 0 0 / 0.35)" : "oklch(0 0 0 / 0.25)",
                }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
