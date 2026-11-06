import { t } from 'i18next';

function marker(title, start, duration, videoID, i) {
    return {
        title: {
            simpleText: title
        },
        startMillis: start,
        durationMillis: duration,
        thumbnailDetails: {
            thumbnails: [
                {
                    url: `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`,
                    width: 320,
                    height: 180
                }
            ]
        },
        onActive: {
            innertubeCommand: {
                clickTrackingParams: null,
                entityUpdateCommand: {
                    entityBatchUpdate: {
                        mutations: [
                            {
                                entityKey: `${videoID}${start}${duration}`,
                                type: 'ENTITY_MUTATION_TYPE_REPLACE',
                                payload: {
                                    markersEngagementPanelSyncEntity: {
                                        key: `${videoID}${start}${duration}`,
                                        panelId: 'engagement-panel-macro-markers-description-chapters',
                                        activeItemIndex: i,
                                        syncEnabled: true
                                    }
                                }
                            }
                        ]
                    }
                }
            }
        }
    }
}

function markerEntity(videoID, markers) {
    return {
        entityKey: `${videoID}-key`,
        type: 'ENTITY_MUTATION_TYPE_REPLACE',
        payload: {
            macroMarkersListEntity: {
                key: `${videoID}-key`,
                externalVideoId: videoID,
                markersList: {
                    markerType: 'MARKER_TYPE_CHAPTERS',
                    markers: markers,
                    headerTitle: {
                        runs: [
                            {
                                text: t('player.chapters.title')
                            }
                        ]
                    },
                    onTap: {
                        innertubeCommand: {
                            clickTrackingParams: null,
                            changeEngagementPanelVisibilityAction: {
                                targetId: 'engagement-panel-macro-markers-description-chapters',
                                visibility: 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'
                            }
                        }
                    },
                    markersEdu: {
                        enterNudgeText: {
                            runs: [
                                {
                                    text: t('player.chapters.enterNudge')
                                }
                            ]
                        },
                        enterNudgeA11yText: t('player.chapters.enterNudge'),
                        navNudgeText: {
                            runs: [
                                {
                                    text: t('player.chapters.navNudge')
                                }
                            ]
                        },
                        navNudgeA11yText: t('player.chapters.navNudgeA11y')
                    },
                    loggingDirectives: {
                        trackingParams: null,
                        enableDisplayloggerExperiment: true
                    }
                }
            }
        }
    }
}

// Chapters come from the desktop (WEB) watch-next response: the TV client's own
// response no longer carries the description (or any chapter data), but the WEB one
// has YouTube's resolved chapter list (creator "DESCRIPTION_CHAPTERS", else
// "AUTO_CHAPTERS") in the player bar markers map. One fetch per video, cached.
const WEB_CLIENT_VERSION = '2.20251101.00.00';
const chapterCache = {};

export function extractChapters(webNext) {
    const markersMap = webNext?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer
        ?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap;
    if (!Array.isArray(markersMap)) return [];
    const entry = markersMap.find(m => m.key === 'DESCRIPTION_CHAPTERS') ||
        markersMap.find(m => m.key === 'AUTO_CHAPTERS') ||
        markersMap.find(m => m?.value?.chapters);
    const chapters = entry?.value?.chapters;
    if (!Array.isArray(chapters)) return [];
    return chapters
        .map(c => c.chapterRenderer)
        .filter(c => c && c.timeRangeStartMillis !== undefined)
        .map(c => ({
            time: Number(c.timeRangeStartMillis),
            name: c.title?.simpleText || (c.title?.runs || []).map(r => r.text).join('')
        }))
        .sort((a, b) => a.time - b.time);
}

export function fetchChapters(videoID) {
    if (chapterCache[videoID]) return chapterCache[videoID];
    chapterCache[videoID] = fetch(`${location.origin}/youtubei/v1/next?prettyPrint=false`, {
        method: 'POST',
        // No cookies: chapters are public data, and the TV session's cookies don't
        // belong to the WEB client.
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            videoId: videoID,
            context: { client: { clientName: 'WEB', clientVersion: WEB_CLIENT_VERSION, hl: 'en' } }
        })
    })
        .then(resp => resp.json())
        .then(extractChapters)
        .catch(err => {
            console.error('TizenTube: failed to fetch chapters', err);
            delete chapterCache[videoID];
            return [];
        });
    return chapterCache[videoID];
}

// Resolves with the current video's duration in ms once the player knows it.
export function videoDurationMs() {
    return new Promise(resolve => {
        let tries = 0;
        (function check() {
            const video = document.querySelector('video');
            if (video && isFinite(video.duration) && video.duration > 0) return resolve(video.duration * 1000);
            if (++tries > 80) return resolve(0);
            setTimeout(check, 250);
        })();
    });
}

export default function Chapters(videoID, chapters, durationMs) {
    let markers = [];

    for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const nextChapter = chapters[i + 1];
        const end = nextChapter ? nextChapter.time : Math.max(durationMs, chapter.time + 1000);
        markers.push(marker(chapter.name, String(chapter.time), String(end - chapter.time), videoID, i));
    }

    return markerEntity(videoID, markers);
}
