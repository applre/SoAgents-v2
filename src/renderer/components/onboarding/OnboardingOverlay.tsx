/**
 * OnboardingOverlay - Spotlight overlay for guided onboarding
 *
 * Uses the inverted box-shadow technique to create a spotlight:
 *   A fixed div over the target element with box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)
 *   dims everything outside while keeping the target interactive (pointer-events: none).
 *
 * When the target element is not in DOM (wrong page), shows a floating nav guide card.
 */

import { useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ONBOARDING_STEPS } from '../../../shared/constants';

interface StepDef {
  targetId: string;
  requiredView: 'settings' | 'launcher';
  title: string;
  description: string;
  tooltipSide: 'top' | 'bottom' | 'left' | 'right';
  manualAdvance?: boolean;
  navLabel: string;
}

const STEPS: StepDef[] = [
  {
    targetId: 'providers-section',
    requiredView: 'settings',
    title: '配置 AI 供应商',
    description: '选择一个供应商并输入 API Key 以开始使用 MyAgents',
    tooltipSide: 'bottom',
    navLabel: '前往设置',
  },
  {
    targetId: 'add-workspace',
    requiredView: 'launcher',
    title: '添加工作区',
    description: '点击这里选择一个文件夹作为您的第一个工作区',
    tooltipSide: 'left',
    navLabel: '前往首页',
  },
  {
    targetId: 'brand-section',
    requiredView: 'launcher',
    title: '您的 Agent 中心',
    description: '这里是与 AI Agent 对话的地方。选好工作区，输入任务即可开始',
    tooltipSide: 'right',
    manualAdvance: true,
    navLabel: '前往首页',
  },
  {
    targetId: 'instruction-input',
    requiredView: 'launcher',
    title: '发送第一个指令',
    description: '告诉 Agent 您想完成什么，按 Enter 或点击发送按钮',
    tooltipSide: 'top',
    navLabel: '前往首页',
  },
];

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface OnboardingOverlayProps {
  currentStep: number;
  activeTabView: 'launcher' | 'settings' | 'chat';
  onNavigateToSettings: () => void;
  onNavigateToLauncher: () => void;
  onStepComplete: () => Promise<void>;
  onSkip: () => Promise<void>;
}

const SPOTLIGHT_PADDING = 6;
const TOOLTIP_GAP = 12;

export default function OnboardingOverlay({
  currentStep,
  activeTabView,
  onNavigateToSettings,
  onNavigateToLauncher,
  onStepComplete,
  onSkip,
}: OnboardingOverlayProps) {
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const mutationObserverRef = useRef<MutationObserver | null>(null);
  const rafRef = useRef<number | null>(null);

  const stepDef = STEPS[currentStep];

  // Measure target element position
  const measureTarget = useCallback(() => {
    if (!stepDef) return;
    const el = document.querySelector(`[data-onboarding-id="${stepDef.targetId}"]`);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
  }, [stepDef]);

  useLayoutEffect(() => {
    // Schedule initial measurement asynchronously to avoid synchronous setState in effect body
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(measureTarget);

    // Watch for resize/layout changes
    const el = stepDef
      ? document.querySelector(`[data-onboarding-id="${stepDef.targetId}"]`)
      : null;

    if (el) {
      observerRef.current = new ResizeObserver(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(measureTarget);
      });
      observerRef.current.observe(el);
      observerRef.current.observe(document.documentElement);
    } else if (stepDef) {
      // Element not in DOM yet (e.g. async load). Watch for it to appear.
      mutationObserverRef.current = new MutationObserver(() => {
        const appeared = document.querySelector(`[data-onboarding-id="${stepDef.targetId}"]`);
        if (!appeared) return;
        mutationObserverRef.current?.disconnect();
        mutationObserverRef.current = null;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(measureTarget);
      });
      mutationObserverRef.current.observe(document.body, { childList: true, subtree: true });
    }

    const handleResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measureTarget);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      mutationObserverRef.current?.disconnect();
      mutationObserverRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', handleResize);
    };
  // activeTabView triggers re-measure when user navigates to the required page
  }, [measureTarget, currentStep, activeTabView]);

  if (!stepDef) return null;

  const isWrongPage = activeTabView !== stepDef.requiredView;
  const navigate = stepDef.requiredView === 'settings' ? onNavigateToSettings : onNavigateToLauncher;

  // Wrong page: show floating guide card
  if (isWrongPage || !targetRect) {
    return createPortal(
      <div
        className="fixed bottom-8 right-8 z-[500] animate-onboarding-appear"
        role="dialog"
        aria-label="引导提示"
      >
        <div
          className="glass-panel p-4 max-w-[260px] flex flex-col gap-3"
          style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="badge text-xs">
              {currentStep + 1} / {ONBOARDING_STEPS.TOTAL}
            </span>
            <button
              onClick={() => void onSkip()}
              className="text-[var(--ink-subtle)] hover:text-[var(--ink-muted)] text-xs transition-colors"
            >
              跳过引导
            </button>
          </div>
          <p className="text-sm font-medium text-[var(--ink)]">{stepDef.title}</p>
          <p className="text-xs text-[var(--ink-muted)] leading-relaxed">{stepDef.description}</p>
          <button
            onClick={navigate}
            className="action-button w-full text-center text-sm py-1.5"
          >
            {stepDef.navLabel} →
          </button>
        </div>
      </div>,
      document.body
    );
  }

  // Spotlight dimensions (add padding around target)
  const spotTop = targetRect.top - SPOTLIGHT_PADDING;
  const spotLeft = targetRect.left - SPOTLIGHT_PADDING;
  const spotWidth = targetRect.width + SPOTLIGHT_PADDING * 2;
  const spotHeight = targetRect.height + SPOTLIGHT_PADDING * 2;

  // Tooltip position calculation
  const tooltipStyle = computeTooltipStyle(stepDef.tooltipSide, spotTop, spotLeft, spotWidth, spotHeight);

  return createPortal(
    <>
      {/* Spotlight div — inverted box-shadow dims everything outside */}
      <div
        style={{
          position: 'fixed',
          top: spotTop,
          left: spotLeft,
          width: spotWidth,
          height: spotHeight,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
          borderRadius: 8,
          zIndex: 500,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />

      {/* Tooltip card */}
      <div
        className="animate-onboarding-appear"
        style={{
          position: 'fixed',
          zIndex: 501,
          ...tooltipStyle,
        }}
        role="dialog"
        aria-label="引导提示"
      >
        <div
          className="glass-panel p-4 flex flex-col gap-3"
          style={{ maxWidth: 280, boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="badge text-xs">
              {currentStep + 1} / {ONBOARDING_STEPS.TOTAL}
            </span>
            <button
              onClick={() => void onSkip()}
              className="text-[var(--ink-subtle)] hover:text-[var(--ink-muted)] text-xs transition-colors"
            >
              跳过
            </button>
          </div>
          <p className="text-sm font-semibold text-[var(--ink)]">{stepDef.title}</p>
          <p className="text-xs text-[var(--ink-muted)] leading-relaxed">{stepDef.description}</p>
          {stepDef.manualAdvance && (
            <button
              onClick={() => void onStepComplete()}
              className="action-button w-full text-center text-sm py-1.5"
            >
              下一步 →
            </button>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

function computeTooltipStyle(
  side: 'top' | 'bottom' | 'left' | 'right',
  spotTop: number,
  spotLeft: number,
  spotWidth: number,
  spotHeight: number
): React.CSSProperties {
  const gap = TOOLTIP_GAP;
  switch (side) {
    case 'bottom':
      return { top: spotTop + spotHeight + gap, left: spotLeft };
    case 'top':
      return { bottom: window.innerHeight - spotTop + gap, left: spotLeft };
    case 'right':
      return { top: spotTop, left: spotLeft + spotWidth + gap };
    case 'left':
      return { top: spotTop, right: window.innerWidth - spotLeft + gap };
  }
}
