import Flutter
import UIKit
import XCTest

class RunnerTests: XCTestCase {

  func testPrivacyManifestIsBundledAndDisablesTracking() throws {
    let url = try XCTUnwrap(
      Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy")
    )
    let data = try Data(contentsOf: url)
    let manifest = try XCTUnwrap(
      PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
    )

    XCTAssertEqual(manifest["NSPrivacyTracking"] as? Bool, false)
    XCTAssertEqual(manifest["NSPrivacyTrackingDomains"] as? [String], [])
    let collected = try XCTUnwrap(
      manifest["NSPrivacyCollectedDataTypes"] as? [[String: Any]]
    )
    let types = Set(collected.compactMap { $0["NSPrivacyCollectedDataType"] as? String })
    XCTAssertTrue(types.contains("NSPrivacyCollectedDataTypeEmailAddress"))
    XCTAssertTrue(types.contains("NSPrivacyCollectedDataTypePhotosorVideos"))
    XCTAssertTrue(types.contains("NSPrivacyCollectedDataTypeOtherUserContent"))
    XCTAssertTrue(collected.allSatisfy { ($0["NSPrivacyCollectedDataTypeTracking"] as? Bool) == false })
  }

}
