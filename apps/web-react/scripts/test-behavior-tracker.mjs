import assert from 'node:assert/strict'
import test from 'node:test'

import {
  behaviorFeatureFromPath,
  behaviorTrackerSnapshot,
  setBehaviorTrackingEnabled,
  trackBehaviorEvent,
} from '../src/legacy-modules/services/behaviorTracker.js'

test('behavior feature mapping stays stable across product routes', () => {
  assert.equal(behaviorFeatureFromPath('/'), 'home')
  assert.equal(behaviorFeatureFromPath('/text-to-image'), 'text_to_image')
  assert.equal(behaviorFeatureFromPath('/assistant?c=one'), 'assistant')
  assert.equal(behaviorFeatureFromPath('/canvas/project-id'), 'canvas')
  assert.equal(behaviorFeatureFromPath('/ecommerce-design'), 'ecommerce')
  assert.equal(behaviorFeatureFromPath('/tools/background-remove'), 'background_remove')
  assert.equal(behaviorFeatureFromPath('/tools/image-compress'), 'media_tools')
})

test('feature opens are held in memory and deduplicated for 30 seconds', () => {
  setBehaviorTrackingEnabled(true)
  assert.equal(trackBehaviorEvent('feature_open', 'canvas'), true)
  assert.equal(trackBehaviorEvent('feature_open', 'canvas'), false)
  assert.equal(behaviorTrackerSnapshot().queued, 1)
  setBehaviorTrackingEnabled(false)
  assert.equal(behaviorTrackerSnapshot().queued, 0)
})

test('tracking is disabled for signed-out visitors', () => {
  setBehaviorTrackingEnabled(false)
  assert.equal(trackBehaviorEvent('feature_open', 'home'), false)
  assert.equal(behaviorTrackerSnapshot().queued, 0)
})
