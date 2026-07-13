import { ArrowLeft, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SearchResponse, Source, Transcription } from '../../types'

export function SearchStage({
  searchQuery,
  searchResults,
  selectedResult,
  transcriptions,
  sources,
  searchSourceId,
  searchStartDate,
  searchEndDate,
  loading,
  onBack,
  onSearch,
  searchHistory,
  onClearSearchHistory,
  onSelectResult,
  onSourceChange,
  onStartDateChange,
  onEndDateChange,
  onExportSrt,
  onExportTxt,
}: {
  searchQuery: string
  searchResults: SearchResponse | null
  selectedResult: SearchResponse['items'][0] | null
  transcriptions: Transcription[]
  sources: Source[]
  searchSourceId: string | undefined
  searchStartDate: string | undefined
  searchEndDate: string | undefined
  loading: boolean
  onBack: () => void
  onSearch: (query: string) => void
  searchHistory: string[]
  onClearSearchHistory: () => void
  onSelectResult: (result: SearchResponse['items'][0]) => void
  onSourceChange: (sourceId: string | undefined) => void
  onStartDateChange: (date: string | undefined) => void
  onEndDateChange: (date: string | undefined) => void
  onExportSrt: (segmentId: string) => void
  onExportTxt: (segmentId: string) => void
}) {
  const [currentTime, setCurrentTime] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [draft, setDraft] = useState(searchQuery)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const resultsListRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setDraft(searchQuery)
  }, [searchQuery])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function submitSearch() {
    const nextQuery = draft.trim()
    if (!nextQuery) return
    onSearch(nextQuery)
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!searchResults?.items.length) return

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, searchResults.items.length - 1))
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onSelectResult(searchResults.items[selectedIndex])
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [searchResults, selectedIndex, onSelectResult])

  useEffect(() => {
    if (resultsListRef.current) {
      const selectedCard = resultsListRef.current.querySelector('.searchResultCard.active')
      if (selectedCard) {
        selectedCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [selectedIndex])

  function formatSearchTime(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  function formatDateTime(value: string | null | undefined) {
    if (!value) return '-'
    return new Date(value).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  function highlightText(text: string, highlight: string) {
    if (!highlight) return text
    const parts = highlight.split('**')
    if (parts.length === 1) return text
    return (
      <>
        {parts[0]}
        <mark>{parts[1]}</mark>
        {parts[2]}
      </>
    )
  }

  return (
    <div className="searchStage">
      <div className="searchHeader">
        <button className="searchBack" onClick={onBack}>
          <ArrowLeft size={18} />
          <span>返回</span>
        </button>
        <div className="searchTitle">
          智能检索
          {searchResults && <span className="searchCount">共 {searchResults.total} 条结果</span>}
        </div>
        <form
          className="searchQueryForm"
          onSubmit={(event) => {
            event.preventDefault()
            submitSearch()
          }}
        >
          <Search size={16} />
          <input
            ref={inputRef}
            className="searchStageInput"
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="搜索语音识别文本"
          />
          {draft && (
            <button className="searchInlineClear" type="button" onClick={() => setDraft('')} title="清除">
              <X size={14} />
            </button>
          )}
          <button className="searchSubmit" type="submit" disabled={!draft.trim()}>
            搜索
          </button>
        </form>
        <div className="searchFilters">
          <select
            value={searchSourceId ?? ''}
            onChange={(e) => onSourceChange(e.target.value || undefined)}
          >
            <option value="">所有摄像头</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={searchStartDate ?? ''}
            onChange={(e) => onStartDateChange(e.target.value || undefined)}
            placeholder="开始日期"
          />
          <input
            type="date"
            value={searchEndDate ?? ''}
            onChange={(e) => onEndDateChange(e.target.value || undefined)}
            placeholder="结束日期"
          />
        </div>
      </div>

      <div className="searchBody">
        {selectedResult && (
          <div className="searchPlayer">
            <div className="searchPlayerWrapper">
              <video
                key={selectedResult.segmentId}
                ref={videoRef}
                className="searchVideo"
                src={`/api/segments/${selectedResult.segmentId}/stream`}
                controls
                onTimeUpdate={() => {
                  if (videoRef.current) {
                    setCurrentTime(videoRef.current.currentTime)
                  }
                }}
                onLoadedMetadata={() => {
                  if (videoRef.current && selectedResult.transcription.startTime > 0) {
                    videoRef.current.currentTime = selectedResult.transcription.startTime
                  }
                }}
              />
              {selectedResult.transcription.startTime > 0 && (
                <div className="searchTimeBadge">
                  {formatSearchTime(selectedResult.transcription.startTime)} / {formatSearchTime(currentTime)}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="searchResults">
          {loading ? (
            <div className="searchLoading">
              <RefreshCw size={20} className="spin" />
              <span>搜索中...</span>
            </div>
          ) : searchResults && searchResults.items.length > 0 ? (
            <>
              <div className="searchResultsHeader">
                <span>搜索结果</span>
              </div>
              <div className="searchResultsList" ref={resultsListRef}>
                {searchResults.items.map((result, index) => (
                  <div
                    key={result.transcription.id}
                    className={`searchResultCard ${index === selectedIndex ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedIndex(index)
                      onSelectResult(result)
                    }}
                  >
                    <div className="searchResultTime">
                      <span className="searchResultDate">{formatDateTime(result.segmentStartTime)}</span>
                      <span className="searchResultSource">{result.sourceName}</span>
                      <span className="searchResultTimestamp">{formatSearchTime(result.transcription.startTime)}</span>
                    </div>
                    <div className="searchResultText">
                      {highlightText(result.transcription.text, result.highlight)}
                    </div>
                    <div className="searchResultActions">
                      <button onClick={(e) => { e.stopPropagation(); onExportSrt(result.segmentId) }} title="导出 SRT 字幕">
                        导出 SRT
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); onExportTxt(result.segmentId) }} title="导出 TXT 文本">
                        导出 TXT
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : searchResults ? (
            <div className="searchEmpty">
              <div className="searchEmptyTitle">没有找到匹配的结果</div>
              <div className="searchEmptySuggestions">
                <p>试试其他关键词：</p>
                <ul>
                  <li>使用更短的关键词</li>
                  <li>检查是否有多音字</li>
                  <li>尝试使用拼音</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="searchEmpty">
              <div className="searchEmptyTitle">输入关键词开始搜索</div>
              {searchHistory.length > 0 && (
                <div className="searchHistoryChips">
                  {searchHistory.slice(0, 6).map((item) => (
                    <button key={item} onClick={() => onSearch(item)}>
                      {item}
                    </button>
                  ))}
                  <button className="searchHistoryClearChip" onClick={onClearSearchHistory}>
                    清除历史
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
