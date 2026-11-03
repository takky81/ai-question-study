import type { LucideIcon } from 'lucide-react';
import { useId, type ReactElement } from 'react';
import { NavLink } from 'react-router';

/** 導線の区分。learn: 出題・統計、manage: カタログ・入出力 */
export type NavGroup = 'learn' | 'manage';

/** 共通レイアウトに渡す導線項目（router.tsx が APP_ROUTES の nav から作る） */
export type NavItem = { path: string; label: string; group: NavGroup; icon: LucideIcon; order: number };

type Variant = 'sidebar' | 'bottom' | 'menu';

const GROUPS: readonly { group: NavGroup; heading: string }[] = [
  { group: 'learn', heading: '学習' },
  { group: 'manage', heading: '管理' },
];

const BASE = 'tap-target focus-ring flex min-w-0 items-center gap-2 text-text';

function linkClass(variant: Variant, isActive: boolean): string {
  if (variant === 'bottom') {
    // 下部バーは現在位置を上ボーダーと太字で示す（5.5）
    const state = isActive ? 'font-bold border-t-4 border-primary' : 'border-t-4 border-transparent';
    return `${BASE} flex-1 flex-col justify-center gap-0.5 px-1 text-xs break-words text-center ${state}`;
  }
  // サイドナビ・メニューは太字と下線で示す（5.5）
  const state = isActive ? 'font-bold underline underline-offset-4' : '';
  return `${BASE} rounded px-3 py-2 break-words ${state}`;
}

/**
 * 区分ごとに導線を表示順で描画する。項目のない区分は見出しごと出さない（5.2、5.6）。
 * 業務データは取得せず、props の項目だけを描画する。
 */
export function NavLinks({ items, variant }: { items: readonly NavItem[]; variant: Variant }): ReactElement {
  const baseId = useId();
  const sections = GROUPS.map(({ group, heading }) => ({
    group,
    heading,
    items: items.filter((i) => i.group === group).sort((a, b) => a.order - b.order),
  })).filter((s) => s.items.length > 0);

  return (
    <div className={variant === 'bottom' ? 'flex min-w-0' : 'flex min-w-0 flex-col gap-4'}>
      {sections.map((s) => {
        const headingId = `${baseId}-${s.group}`;
        return (
          <section key={s.group} aria-labelledby={headingId} className="min-w-0 flex-1">
            <h2
              id={headingId}
              className={variant === 'bottom' ? 'sr-only' : 'px-3 pb-1 text-sm font-semibold text-text-muted'}
            >
              {s.heading}
            </h2>
            <ul className={variant === 'bottom' ? 'flex min-w-0' : 'flex min-w-0 flex-col gap-1'}>
              {s.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.path} className={variant === 'bottom' ? 'flex min-w-0 flex-1' : 'min-w-0'}>
                    <NavLink to={item.path} className={({ isActive }) => linkClass(variant, isActive)}>
                      <Icon aria-hidden="true" className="size-5 shrink-0" />
                      <span className="min-w-0">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
