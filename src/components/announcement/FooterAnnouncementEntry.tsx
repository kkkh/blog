/**
 * FooterAnnouncementEntry Component
 *
 * Entry point in Footer to view all announcements.
 * Shows unread badge when there are unread announcements.
 */

import { LazyMotionProvider } from '@components/common/LazyMotionProvider';
import { useIsMounted } from '@hooks/useIsMounted';
import { useMotionLevel } from '@hooks/useMotionLevel';
// ── 本站新增 ────────────────────────────────────────────────────────────────
// 引入理由：改动前这段页脚文案是写死的英文字符串（原写法保留在下方 JSX 的注释里），
// 遇到中文站也会显示英文。改为读取 i18n 词条后，中文站显示「通知公告」、
// 英文站显示 "Announcements"，且以后改文案只需改词条、不用再动组件代码。
import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { cn } from '@lib/utils';
import { useStore } from '@nanostores/react';
import { activeAnnouncements, openAnnouncementList, unreadCount } from '@store/announcement';
import { AnimatePresence, m } from 'motion/react';

export default function FooterAnnouncementEntry() {
  const shouldReduceMotion = useMotionLevel() === 'reduced';
  const isMounted = useIsMounted();
  const count = useStore(unreadCount);
  const announcements = useStore(activeAnnouncements);
  // ── 本站新增 ──────────────────────────────────────────────────────────────
  // 取「当前语言」下的翻译函数 t，供下方页脚文案使用（中文 → 通知公告，英文 → Announcements）。
  // ⚠️ 位置很关键：必须写在下面那个提前 return 之前 —— React 要求 hooks 在每次渲染中
  //    按相同顺序、无条件调用；若放到 return 之后，未渲染路径与渲染路径的 hook
  //    数量不一致，会直接抛错（Hooks 规则）。
  const { t } = useTranslation();

  // Don't render during SSR or if no active announcements
  if (!isMounted || announcements.length === 0) {
    return null;
  }

  return (
    <LazyMotionProvider>
      <button
        type="button"
        onClick={openAnnouncementList}
        aria-expanded={false}
        aria-haspopup="dialog"
        className={cn(
          'relative flex items-center gap-1.5 opacity-75 transition-opacity duration-300 hover:opacity-100',
          'text-muted-foreground text-sm',
        )}
        /*
         * ── 本站改动：以下为改动前的原代码，原文保留备查，请勿删除 ──────────────
         * 原属性： title="View announcements"
         * 注释原因：这是写死的英文字符串，中文站也会显示英文，与本站中文优先的界面不符。
         * 现改为读取 i18n 词条 announcement.title：
         *   中文站 → 「通知公告」（见 src/i18n/translations/zh.ts）
         *   英文站 → "Announcements"（见 src/i18n/translations/en.ts，该词条未改动）
         */
        title={t('announcement.title')}
      >
        <Icon icon="ri:notification-3-line" className="h-4 w-4" />
        {/* ── 本站改动：以下为改动前的原代码，原文保留备查，请勿删除 ────────────
            原标签： <span>Announcements</span>
            注释原因：同上 —— 写死英文，中文站也会显示英文。
            现改为 <span>{t('announcement.title')}</span>，跟随语言切换分别显示
            中文「通知公告」或英文 "Announcements"。 */}
        <span>{t('announcement.title')}</span>

        {/* Unread badge - only show after mount to avoid hydration mismatch */}
        <AnimatePresence>
          {isMounted && count > 0 && (
            <m.span
              initial={shouldReduceMotion ? false : { scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : undefined}
              className={cn(
                'absolute -top-1 -right-2',
                'flex items-center justify-center',
                'h-4 min-w-[1rem] px-1',
                'bg-destructive text-destructive-foreground',
                'rounded-full font-medium text-xs',
              )}
            >
              {count > 9 ? '9+' : count}
            </m.span>
          )}
        </AnimatePresence>
      </button>
    </LazyMotionProvider>
  );
}
