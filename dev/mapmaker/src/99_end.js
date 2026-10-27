
return {
  get on() { return !!M.on; }, get docked() { return !!M.docked; }, get screen() { return M.screen; },
  open, close, openMap, openFromLive, onLiveOpen, onLiveClose, liveShot, promptLines, preload, applyTag, fromTag, mapTags, exportAll, importAll,
  test: T,
  _t: { M, MC, Gen, Samples, Store, Wx, OSMX, CATS, KINDS, GROUPS, ACTS, assemble, createView, prepare, fitCam, drawScene, stripLayout, parkLayout, storeLayout, treemap, searchPois, findPoi, select, gpsSet, layout, setSheet, setTab, renderMsgs, shotBlob, makeThumb },
};
})();
