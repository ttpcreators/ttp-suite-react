import * as React from "react";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import {
  format,
  addMonths,
  subMonths,
  isSameDay,
  isToday,
  getDate,
  getDaysInMonth,
  startOfMonth,
} from "date-fns";
import { fr } from "date-fns/locale";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface Day {
  date: Date;
  isToday: boolean;
  isSelected: boolean;
  hasEvent: boolean;
}

interface GlassCalendarProps extends React.HTMLAttributes<HTMLDivElement> {
  selectedDate?: Date;
  onDateSelect?: (date: Date) => void;
  /** Jours (yyyy-MM-dd) qui ont au moins un événement → pastille. */
  eventDates?: Set<string>;
  onNewEvent?: () => void;
  className?: string;
}

const ScrollbarHide = () => (
  <style>{`
    .cal-scroll::-webkit-scrollbar { display: none; }
    .cal-scroll { -ms-overflow-style: none; scrollbar-width: none; }
  `}</style>
);

export const GlassCalendar = React.forwardRef<HTMLDivElement, GlassCalendarProps>(
  (
    { className, selectedDate: propSelectedDate, onDateSelect, eventDates, onNewEvent, ...props },
    ref,
  ) => {
    const [currentMonth, setCurrentMonth] = React.useState(propSelectedDate || new Date());
    const [selectedDate, setSelectedDate] = React.useState(propSelectedDate || new Date());
    const scrollRef = React.useRef<HTMLDivElement>(null);

    const monthDays = React.useMemo(() => {
      const start = startOfMonth(currentMonth);
      const totalDays = getDaysInMonth(currentMonth);
      const days: Day[] = [];
      for (let i = 0; i < totalDays; i++) {
        const date = new Date(start.getFullYear(), start.getMonth(), i + 1);
        days.push({
          date,
          isToday: isToday(date),
          isSelected: isSameDay(date, selectedDate),
          hasEvent: eventDates?.has(format(date, "yyyy-MM-dd")) ?? false,
        });
      }
      return days;
    }, [currentMonth, selectedDate, eventDates]);

    const handleDateClick = (date: Date) => {
      setSelectedDate(date);
      onDateSelect?.(date);
    };

    const goToday = () => {
      const now = new Date();
      setCurrentMonth(now);
      setSelectedDate(now);
      onDateSelect?.(now);
    };

    return (
      <div
        ref={ref}
        className={cn(
          "w-full overflow-hidden rounded-3xl border border-white/10 p-5 text-white shadow-2xl",
          "bg-gradient-to-br from-[#0b1220] via-[#141a2e] to-[#0b1220]",
          className,
        )}
        {...props}
      >
        <ScrollbarHide />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
            <span className="rounded-md bg-white px-4 py-1 text-xs font-bold text-black shadow-md">
              {format(currentMonth, "yyyy")}
            </span>
            <button
              type="button"
              onClick={goToday}
              className="rounded-md px-3 py-1 text-xs font-semibold text-white/60 transition-colors hover:text-white"
            >
              Aujourd'hui
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Month name */}
        <div className="my-6">
          <motion.p
            key={format(currentMonth, "MMMM-yyyy")}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-4xl font-bold capitalize tracking-tight"
          >
            {format(currentMonth, "MMMM", { locale: fr })}
          </motion.p>
        </div>

        {/* Days strip */}
        <div ref={scrollRef} className="cal-scroll -mx-5 overflow-x-auto px-5">
          <div className="flex gap-4">
            {monthDays.map((day) => (
              <div
                key={format(day.date, "yyyy-MM-dd")}
                className="flex flex-shrink-0 flex-col items-center gap-2"
              >
                <span className="text-xs font-bold uppercase text-white/50">
                  {format(day.date, "EEEEE", { locale: fr })}
                </span>
                <button
                  type="button"
                  onClick={() => handleDateClick(day.date)}
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all duration-200",
                    day.isSelected
                      ? "bg-gradient-to-br from-pink-500 to-orange-400 text-white shadow-lg"
                      : "text-white hover:bg-white/15",
                  )}
                >
                  {getDate(day.date)}
                  {!day.isSelected && (day.hasEvent || day.isToday) && (
                    <span
                      className={cn(
                        "absolute bottom-1 h-1 w-1 rounded-full",
                        day.hasEvent ? "bg-emerald-400" : "bg-pink-400",
                      )}
                    />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 h-px bg-white/15" />

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between gap-4">
          <span className="min-w-0 flex-1 truncate text-sm font-medium capitalize text-white/70">
            {format(selectedDate, "EEEE d MMMM", { locale: fr })}
          </span>
          <button
            type="button"
            onClick={onNewEvent}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white shadow-md transition-colors hover:bg-white/20"
          >
            <Plus className="h-4 w-4" />
            <span>Nouvel événement</span>
          </button>
        </div>
      </div>
    );
  },
);

GlassCalendar.displayName = "GlassCalendar";
