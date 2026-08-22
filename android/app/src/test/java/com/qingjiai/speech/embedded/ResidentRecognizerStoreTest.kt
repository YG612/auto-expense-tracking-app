package com.qingjiai.speech.embedded

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ResidentRecognizerStoreTest {
  @Test
  fun `sessions reuse one resident recognizer until memory pressure release`() {
    var created = 0
    var released = 0
    val store = ResidentRecognizerStore<Any> { released++ }

    val first = store.obtain { Any().also { created++ } }
    val second = store.obtain { Any().also { created++ } }
    assertSame(first, second)
    assertEquals(1, created)
    assertTrue(store.isResident())

    store.releaseIdle()
    store.releaseIdle()
    assertEquals(1, released)
    assertFalse(store.isResident())
    val third = store.obtain { Any().also { created++ } }
    assertEquals(2, created)
    assertTrue(third !== first)
  }
}
