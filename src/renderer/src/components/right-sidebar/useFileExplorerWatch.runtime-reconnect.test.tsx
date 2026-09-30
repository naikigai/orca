// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileExplorerTreeRefreshOutcome } from './file-explorer-types'

vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (state: unknown) => unknown) => selector({}), {
    getState: () => ({})
  })
}))
vi.mock('./file-explorer-operation-owner', () => ({
  getFileExplorerOperationOwner: () => ({
    kind: 'runtime',
    environmentId: 'runtime-1',
    executionHostId: 'runtime:runtime-1'
  }),
  getFileExplorerOperationOwnerFromState: () => ({
    kind: 'runtime',
    environmentId: 'runtime-1',
    executionHostId: 'runtime:runtime-1'
  })
}))

import { useFileExplorerWatch } from './useFileExplorerWatch'

type RuntimeCallbacks = Parameters<typeof window.api.runtimeEnvironments.subscribe>[1]

describe('File Explorer runtime watch reconnection', () => {
  const callbacks: RuntimeCallbacks[] = []
  const subscribe = vi.fn(async (_request: unknown, nextCallbacks: RuntimeCallbacks) => {
    callbacks.push(nextCallbacks)
    return { unsubscribe: vi.fn(), sendBinary: vi.fn() }
  })
  const refreshTree = vi.fn<() => Promise<FileExplorerTreeRefreshOutcome>>(async () => 'refreshed')

  beforeEach(() => {
    vi.useFakeTimers()
    callbacks.length = 0
    subscribe.mockClear()
    refreshTree.mockClear()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { runtimeEnvironments: { subscribe } }
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it.each(['terminal error', 'transport close'])(
    'restarts the shared watch after %s',
    async (termination) => {
      const initialProps: { path: string | null } = { path: '/repo' }
      const hook = renderHook(
        ({ path }: { path: string | null }) =>
          useFileExplorerWatch({
            worktreePath: path,
            activeWorktreeId: 'wt-1',
            dirCache: { '/repo': { children: [] } },
            setDirCache: vi.fn(),
            expanded: new Set(),
            setSelectedPath: vi.fn(),
            refreshDir: vi.fn(async () => {}),
            refreshTree,
            inlineInput: null,
            dragSourcePath: null,
            isNativeDragOver: false,
            operationOwner: {
              kind: 'runtime',
              environmentId: 'runtime-1',
              executionHostId: 'runtime:runtime-1'
            }
          }),
        { initialProps }
      )
      await act(async () => {})
      expect(subscribe).toHaveBeenCalledOnce()

      act(() => {
        if (termination === 'terminal error') {
          callbacks[0].onResponse({
            id: 'watch-1',
            ok: true,
            result: { type: 'error', message: 'watcher stopped' },
            _meta: { runtimeId: 'remote-runtime' }
          })
          callbacks[0].onResponse({
            id: 'watch-1',
            ok: true,
            result: { type: 'end' },
            _meta: { runtimeId: 'remote-runtime' }
          })
        } else {
          callbacks[0].onClose?.()
        }
      })
      await act(async () => vi.advanceTimersByTimeAsync(1_001))

      expect(subscribe).toHaveBeenCalledTimes(2)
      expect(refreshTree).toHaveBeenCalledOnce()

      act(() => callbacks[1].onClose?.())
      hook.rerender({ path: null })
      await act(async () => vi.advanceTimersByTimeAsync(30_000))
      expect(subscribe).toHaveBeenCalledTimes(2)
    }
  )
})
