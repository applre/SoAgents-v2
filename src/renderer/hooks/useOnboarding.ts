/**
 * useOnboarding - Manages first-run guided onboarding state
 *
 * Loads progress from config.json on mount.
 * undefined onboarding config = first launch = start at step 0.
 * Listens for CONFIG_CHANGED to auto-advance steps 0 and 1.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadAppConfig, atomicModifyConfig } from '@/config/configService';
import { type OnboardingProgress } from '@/config/types';
import { CUSTOM_EVENTS, ONBOARDING_STEPS } from '../../shared/constants';

export interface UseOnboardingResult {
  isActive: boolean;
  currentStep: number;
  visitedPages: { settings: boolean; launcher: boolean };
  markStepComplete: () => Promise<void>;
  skipOnboarding: () => Promise<void>;
  trackPageVisit: (page: 'settings' | 'launcher') => void;
}

export function useOnboarding(): UseOnboardingResult {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const progressRef = useRef(progress);

  // Sync ref in effect to avoid mutating during render
  useEffect(() => {
    progressRef.current = progress;
  });

  // Load onboarding progress on mount
  useEffect(() => {
    void loadAppConfig().then((config) => {
      if (config.onboarding === undefined) {
        // First launch: initialize onboarding at step 0
        const initial: OnboardingProgress = {
          completed: false,
          skipped: false,
          currentStep: ONBOARDING_STEPS.API_KEY,
          visitedPages: { settings: false, launcher: false },
        };
        setProgress(initial);
        // Persist initial state
        void atomicModifyConfig((cfg) => ({ ...cfg, onboarding: initial }));
      } else {
        setProgress(config.onboarding);
      }
    });
  }, []);

  // Listen for CONFIG_CHANGED to auto-advance steps 0 and 1
  useEffect(() => {
    const handleConfigChanged = () => {
      const current = progressRef.current;
      if (!current || current.completed || current.skipped) return;

      void loadAppConfig().then((config) => {
        const cur = progressRef.current;
        if (!cur || cur.completed || cur.skipped) return;

        // Step 0: advance when first API key is added
        if (cur.currentStep === ONBOARDING_STEPS.API_KEY) {
          const hasKey = Object.keys(config.providerApiKeys ?? {}).length > 0;
          if (hasKey) {
            const next: OnboardingProgress = { ...cur, currentStep: ONBOARDING_STEPS.WORKSPACE };
            setProgress(next);
            void atomicModifyConfig((cfg) => ({ ...cfg, onboarding: next }));
          }
        }

        // Step 1: advance when first workspace is added
        if (cur.currentStep === ONBOARDING_STEPS.WORKSPACE) {
          // We can't directly check projects here without loadProjects,
          // but addProject fires CONFIG_CHANGED so we'll check projects.json
          // via a side-effect. For simplicity, rely on ONBOARDING_WORKSPACE_ADDED event.
        }
      });
    };

    window.addEventListener(CUSTOM_EVENTS.CONFIG_CHANGED, handleConfigChanged);
    return () => window.removeEventListener(CUSTOM_EVENTS.CONFIG_CHANGED, handleConfigChanged);
  }, []);

  // Listen for ONBOARDING_WORKSPACE_ADDED (fired by Launcher after addProject)
  useEffect(() => {
    const handleWorkspaceAdded = () => {
      const cur = progressRef.current;
      if (!cur || cur.completed || cur.skipped) return;
      if (cur.currentStep !== ONBOARDING_STEPS.WORKSPACE) return;

      const next: OnboardingProgress = { ...cur, currentStep: ONBOARDING_STEPS.BRAND };
      setProgress(next);
      void atomicModifyConfig((cfg) => ({ ...cfg, onboarding: next }));
    };

    window.addEventListener('onboarding:workspace-added', handleWorkspaceAdded);
    return () => window.removeEventListener('onboarding:workspace-added', handleWorkspaceAdded);
  }, []);

  // Listen for ONBOARDING_INSTRUCTION_SUBMITTED (fired by Launcher on first send)
  useEffect(() => {
    const handleInstructionSubmitted = () => {
      const cur = progressRef.current;
      if (!cur || cur.completed || cur.skipped) return;
      if (cur.currentStep !== ONBOARDING_STEPS.INSTRUCTION) return;

      const next: OnboardingProgress = { ...cur, completed: true };
      setProgress(next);
      void atomicModifyConfig((cfg) => ({ ...cfg, onboarding: next }));
    };

    window.addEventListener(CUSTOM_EVENTS.ONBOARDING_INSTRUCTION_SUBMITTED, handleInstructionSubmitted);
    return () => window.removeEventListener(CUSTOM_EVENTS.ONBOARDING_INSTRUCTION_SUBMITTED, handleInstructionSubmitted);
  }, []);

  const markStepComplete = useCallback(async () => {
    const cur = progressRef.current;
    if (!cur) return;

    const nextStep = cur.currentStep + 1;
    const completed = nextStep >= ONBOARDING_STEPS.TOTAL;
    const next: OnboardingProgress = {
      ...cur,
      currentStep: completed ? cur.currentStep : nextStep,
      completed,
    };
    setProgress(next);
    await atomicModifyConfig((cfg) => ({ ...cfg, onboarding: next }));
  }, []);

  const skipOnboarding = useCallback(async () => {
    const cur = progressRef.current;
    if (!cur) return;
    const next: OnboardingProgress = { ...cur, skipped: true, completed: true };
    setProgress(next);
    await atomicModifyConfig((cfg) => ({ ...cfg, onboarding: next }));
  }, []);

  const trackPageVisit = useCallback((page: 'settings' | 'launcher') => {
    const cur = progressRef.current;
    if (!cur || cur.visitedPages[page]) return;
    const next: OnboardingProgress = {
      ...cur,
      visitedPages: { ...cur.visitedPages, [page]: true },
    };
    setProgress(next);
    void atomicModifyConfig((cfg) => ({ ...cfg, onboarding: next }));
  }, []);

  const isActive = progress !== null && !progress.completed && !progress.skipped;

  return {
    isActive,
    currentStep: progress?.currentStep ?? 0,
    visitedPages: progress?.visitedPages ?? { settings: false, launcher: false },
    markStepComplete,
    skipOnboarding,
    trackPageVisit,
  };
}
