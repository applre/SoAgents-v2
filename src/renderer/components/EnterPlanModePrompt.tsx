import { ClipboardList, X, Check, CheckCircle, XCircle } from 'lucide-react';

import type { EnterPlanModeRequest } from '../../shared/types/planMode';

interface EnterPlanModePromptProps {
    request: EnterPlanModeRequest;
    onApprove: () => void;
    onReject: () => void;
}

/**
 * EnterPlanMode prompt - AI requests to enter plan mode
 */
export function EnterPlanModePrompt({ request, onApprove, onReject }: EnterPlanModePromptProps) {
    const isResolved = !!request.resolved;
    const isApproved = request.resolved === 'approved';

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className={`mx-auto max-w-2xl rounded-xl border p-4 shadow-sm ${
                isResolved && !isApproved
                    ? 'border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/40'
                    : 'border-blue-200 bg-blue-50/80 dark:border-blue-800 dark:bg-blue-950/40'
            }`}>
                {/* Header */}
                <div className={`${isResolved ? '' : 'mb-3'} flex items-center gap-2`}>
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        isResolved && !isApproved
                            ? 'bg-gray-100 dark:bg-gray-800'
                            : 'bg-blue-100 dark:bg-blue-900/50'
                    }`}>
                        <ClipboardList className={`h-4.5 w-4.5 ${
                            isResolved && !isApproved
                                ? 'text-gray-500 dark:text-gray-400'
                                : 'text-blue-600 dark:text-blue-400'
                        }`} />
                    </div>
                    <div className="flex-1">
                        <h3 className={`text-sm font-semibold ${
                            isResolved && !isApproved
                                ? 'text-gray-700 dark:text-gray-300'
                                : 'text-blue-900 dark:text-blue-100'
                        }`}>进入计划模式</h3>
                        <p className={`text-xs ${
                            isResolved && !isApproved
                                ? 'text-gray-500 dark:text-gray-400'
                                : 'text-blue-600 dark:text-blue-400'
                        }`}>AI 希望切换到计划模式，先设计方案再执行</p>
                    </div>
                    {/* Resolved badge in header */}
                    {isResolved && (
                        <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                            isApproved
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                            {isApproved
                                ? <><CheckCircle className="h-3.5 w-3.5" />已批准</>
                                : <><XCircle className="h-3.5 w-3.5" />已拒绝</>
                            }
                        </div>
                    )}
                </div>

                {/* Actions - only show when not resolved */}
                {!isResolved && (
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={onReject}
                            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                        >
                            <X className="h-3.5 w-3.5" />
                            拒绝
                        </button>
                        <button
                            onClick={onApprove}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                        >
                            <Check className="h-3.5 w-3.5" />
                            批准
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
