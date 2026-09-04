/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @return {boolean} */
function checkStorageSupport() {
  return shaka.offline.Storage.support();
}

filterDescribe('Storage', checkStorageSupport, () => {
  const Util = shaka.test.Util;

  /** @type {!jasmine.Spy} */
  let onErrorSpy;

  /** @type {!HTMLVideoElement} */
  let video;
  /** @type {shaka.Player} */
  let player;
  /** @type {shaka.offline.Storage} */
  let storage;
  /** @type {!shaka.util.EventManager} */
  let eventManager;

  let compiledShaka;

  /** @type {!shaka.test.Waiter} */
  let waiter;

  // TEMPORARY INSTRUMENTATION, NOT FOR UPSTREAM.  "supports DASH AES-128
  // download and playback" hangs for its whole two minute timeout on Safari,
  // in about one run in thirty.  Tracing IndexedDB and the network showed both
  // finishing their work identically to a passing run, all of it inside the
  // first tenth of a second, followed by two minutes of complete silence.  So
  // something here is awaited and never comes back, and this says which.
  let stepSeq = 0;
  /** @param {string} label */
  function step(label) {
    if (window['dump']) {
      window['dump']('[step] ' + (++stepSeq) + ' ' + label +
          ' @' + Math.round(performance.now()));
    }
  }

  async function eraseStorage(who) {
    /** @type {!shaka.offline.StorageMuxer} */
    const muxer = new shaka.offline.StorageMuxer();

    try {
      step(who + ' erase: muxer.erase');
      await muxer.erase();
      step(who + ' erase: muxer.erase done');
    } finally {
      step(who + ' erase: muxer.destroy');
      await muxer.destroy();
      step(who + ' erase: muxer.destroy done');
    }
  }

  beforeAll(async () => {
    video = shaka.test.UiUtils.createVideoElement();
    document.body.appendChild(video);
    compiledShaka =
        await shaka.test.Loader.loadShaka(getClientArg('uncompiled'));
  });

  beforeEach(async () => {
    step('beforeEach start');
    // Make sure we start with a clean slate between each run.
    await eraseStorage('beforeEach');

    step('beforeEach: createManifests');
    await shaka.test.TestScheme.createManifests(compiledShaka, '_compiled');
    step('beforeEach: createManifests done');
    player = new compiledShaka.Player();
    storage = new compiledShaka.offline.Storage(player);
    step('beforeEach: attach');
    await player.attach(video);
    step('beforeEach: attach done');

    // Disable stall detection, which can interfere with playback tests.
    player.configure('streaming.stallEnabled', false);

    // Grab event manager from the uncompiled library:
    eventManager = new shaka.util.EventManager();
    waiter = new shaka.test.Waiter(eventManager);
    waiter.setPlayer(player);

    onErrorSpy = jasmine.createSpy('onError');
    onErrorSpy.and.callFake((event) => fail(event.detail));
    eventManager.listen(player, 'error', Util.spyFunc(onErrorSpy));
    step('beforeEach done');
  });

  afterEach(async () => {
    step('afterEach start');
    eventManager.release();
    step('afterEach: storage.destroy');
    await storage.destroy();
    step('afterEach: storage.destroy done');
    await player.destroy();
    step('afterEach: player.destroy done');

    // Make sure we don't leave anything behind.
    await eraseStorage('afterEach');
    step('afterEach done');
  });

  afterAll(() => {
    document.body.removeChild(video);
  });

  it('supports DASH AES-128 download and playback', async () => {
    const url = '/base/test/test/assets/dash-aes-128/dash.mpd';
    const metadata = {
      'title': 'DASH AES-128',
      'downloaded': new Date(),
    };

    step('spec: store');
    const result = await storage.store(url, metadata).promise;
    step('spec: store done');

    step('spec: load');
    await player.load(result.offlineUri);
    step('spec: load done');
    await video.play();
    step('spec: play done');
    expect(player.isLive()).toBe(false);

    // Wait for the video to start playback.  If it takes longer than 10
    // seconds, fail the test.
    step('spec: waitForMovement');
    await waiter.waitForMovementOrFailOnTimeout(video, 10);
    step('spec: waitForMovement done');

    // Play for 2 seconds, but stop early if the video ends.  If it takes
    // longer than 10 seconds, fail the test.
    step('spec: waitUntilPlayheadReaches');
    await waiter.waitUntilPlayheadReachesOrFailOnTimeout(video, 2, 10);
    step('spec: waitUntilPlayheadReaches done');

    await player.unload();
    step('spec: unload done');
  });

  it('supports HLS AES-256 download and playback', async () => {
    const url = '/base/test/test/assets/hls-aes-256/media.m3u8';
    const metadata = {
      'title': 'HLS AES-256',
      'downloaded': new Date(),
    };

    const result = await storage.store(url, metadata).promise;

    await player.load(result.offlineUri);
    await video.play();
    expect(player.isLive()).toBe(false);

    // Wait for the video to start playback.  If it takes longer than 10
    // seconds, fail the test.
    await waiter.waitForMovementOrFailOnTimeout(video, 10);

    // Play for 2 seconds, but stop early if the video ends.  If it takes
    // longer than 10 seconds, fail the test.
    await waiter.waitUntilPlayheadReachesOrFailOnTimeout(video, 2, 10);

    await player.unload();
  });

  drmIt('supports HLS SAMPLE-AES download and playback', async () => {
    if (!checkClearKeySupport()) {
      pending('ClearKey is not supported');
    }
    const url = '/base/test/test/assets/hls-sample-aes/index.m3u8';
    const metadata = {
      'title': 'HLS SAMPLE-AES',
      'downloaded': new Date(),
    };

    const result = await storage.store(url, metadata).promise;

    await player.load(result.offlineUri);
    await video.play();
    expect(player.isLive()).toBe(false);

    // Wait for the video to start playback.  If it takes longer than 10
    // seconds, fail the test.
    await waiter.waitForMovementOrFailOnTimeout(video, 10);

    // Play for 2 seconds, but stop early if the video ends.  If it takes
    // longer than 10 seconds, fail the test.
    await waiter.waitUntilPlayheadReachesOrFailOnTimeout(video, 2, 10);

    await player.unload();
  });

  it('supports ClearKey with raw single key', async () => {
    if (!checkClearKeySupport()) {
      pending('ClearKey is not supported');
    }

    storage.configure({
      drm: {
        clearKeys: {
          // cspell: disable
          // eslint-disable-next-line @stylistic/max-len
          '4060a865887842679cbf91ae5bae1e72': 'fc35340837310cc0fb53de97e22a69e0',
          // cspell: enable
        },
      },
    });

    const url = '/base/test/test/assets/dash-clearkey/dash.mpd';
    const metadata = {
      'title': 'ClearKey with raw single key',
      'downloaded': new Date(),
    };

    const result = await storage.store(url, metadata).promise;

    await player.load(result.offlineUri);
    await video.play();
    expect(player.isLive()).toBe(false);

    // Wait for the video to start playback.  If it takes longer than 10
    // seconds, fail the test.
    await waiter.waitForMovementOrFailOnTimeout(video, 10);

    // Play for 2 seconds, but stop early if the video ends.  If it takes
    // longer than 10 seconds, fail the test.
    await waiter.waitUntilPlayheadReachesOrFailOnTimeout(video, 2, 10);

    await player.unload();
  });

  it('supports ClearKey with fake single key', async () => {
    if (!checkClearKeySupport()) {
      pending('ClearKey is not supported');
    }

    storage.configure({
      drm: {
        clearKeys: {
          '0000000000000000000000': '0000000000000000000000',
        },
      },
    });

    const url = '/base/test/test/assets/dash-clearkey/dash.mpd';
    const metadata = {
      'title': 'ClearKey with fake single key',
      'downloaded': new Date(),
    };

    const result = await storage.store(url, metadata).promise;

    player.configure({
      drm: {
        clearKeys: {
          // cspell: disable
          // eslint-disable-next-line @stylistic/max-len
          '4060a865887842679cbf91ae5bae1e72': 'fc35340837310cc0fb53de97e22a69e0',
          // cspell: enable
        },
      },
    });

    await player.load(result.offlineUri);
    await video.play();
    expect(player.isLive()).toBe(false);

    // Wait for the video to start playback.  If it takes longer than 10
    // seconds, fail the test.
    await waiter.waitForMovementOrFailOnTimeout(video, 10);

    // Play for 2 seconds, but stop early if the video ends.  If it takes
    // longer than 10 seconds, fail the test.
    await waiter.waitUntilPlayheadReachesOrFailOnTimeout(video, 2, 10);

    await player.unload();
  });

  it('supports HLS chapters download and playback', async () => {
    const url = '/base/test/test/assets/hls-chapters/index.m3u8';
    const metadata = {
      'title': 'HLS Chapters',
      'downloaded': new Date(),
    };

    const result = await storage.store(url, metadata).promise;

    await player.load(result.offlineUri);
    await video.play();
    expect(player.isLive()).toBe(false);

    expect(player.getChaptersTracks().length).toBe(1);

    const chapters = await player.getChaptersAsync('und');

    expect(chapters.length).toBe(7);

    // Play for 2 seconds, but stop early if the video ends.  If it takes
    // longer than 10 seconds, fail the test.
    await waiter.waitUntilPlayheadReachesOrFailOnTimeout(video, 2, 10);

    await player.unload();
  });
});
