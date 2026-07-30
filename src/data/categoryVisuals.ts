import { type ComponentType } from 'react';
import { Smartphone, CookingPot, Pen, Printer, Scissors, BookOpen, Trophy, Palette, Package } from 'lucide-react';

export interface CategoryVisual {
  gradient: string;
  icon: ComponentType<{ className?: string }>;
  glow: string;
}

export const CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  'Electronics': { gradient: 'from-violet-900/80 via-indigo-800/50 to-slate-900/90', icon: Smartphone, glow: 'rgba(139,92,246,0.15)' },
  'Eatery': { gradient: 'from-amber-800/80 via-orange-700/50 to-stone-900/90', icon: CookingPot, glow: 'rgba(245,158,11,0.15)' },
  'Stationery': { gradient: 'from-emerald-800/80 via-teal-700/50 to-slate-900/90', icon: Pen, glow: 'rgba(16,185,129,0.15)' },
  'Printing': { gradient: 'from-purple-800/80 via-fuchsia-700/50 to-slate-900/90', icon: Printer, glow: 'rgba(168,85,247,0.15)' },
  'Tailoring': { gradient: 'from-pink-800/80 via-rose-700/50 to-stone-900/90', icon: Scissors, glow: 'rgba(244,63,94,0.15)' },
  'Library': { gradient: 'from-stone-800/80 via-zinc-700/50 to-slate-900/90', icon: BookOpen, glow: 'rgba(120,113,108,0.15)' },
  'Sports': { gradient: 'from-orange-800/80 via-amber-700/50 to-stone-900/90', icon: Trophy, glow: 'rgba(251,146,60,0.15)' },
  'Graphics': { gradient: 'from-cyan-800/80 via-sky-700/50 to-slate-900/90', icon: Palette, glow: 'rgba(6,182,212,0.15)' },
};

export const DEFAULT_CATEGORY_VISUAL: CategoryVisual = {
  gradient: 'from-zinc-800/80 via-zinc-700/50 to-slate-900/90',
  icon: Package,
  glow: 'rgba(0,0,0,0.1)',
};