import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/assets/assets.dart';
import '../features/assistant/assistant.dart';
import '../features/benefits/benefits.dart';
import '../features/billing/billing.dart';
import '../features/checkin/checkin.dart';
import '../features/discover/discover.dart';
import '../features/feedback/feedback.dart';
import '../features/gallery/gallery.dart';
import '../features/notifications/notifications.dart';
import '../features/profile/profile.dart';
import '../features/tasks/tasks.dart';
import '../features/wallet/wallet.dart';

class UserSessionCache {
  const UserSessionCache(this._ref);

  final Ref _ref;

  void clear() {
    _ref.invalidate(profileOverviewProvider);
    _ref.invalidate(walletProvider);
    _ref.invalidate(walletCenterControllerProvider);
    _ref.invalidate(purchaseCenterControllerProvider);
    _ref.invalidate(benefitsControllerProvider);
    _ref.invalidate(checkinControllerProvider);
    _ref.invalidate(assetCenterControllerProvider);
    _ref.invalidate(feedbackCenterControllerProvider);
    _ref.invalidate(myGallerySubmissionsProvider);
    _ref.invalidate(gallerySubmissionSummaryProvider);
    _ref.invalidate(gallerySubmissionForTaskProvider);
    _ref.invalidate(myGallerySubmissionsControllerProvider);
    _ref.invalidate(notificationSummaryProvider);
    _ref.invalidate(notificationCenterControllerProvider);
    _ref.invalidate(taskListProvider);
    _ref.invalidate(taskCenterControllerProvider);
    _ref.invalidate(taskDetailProvider);
    _ref.invalidate(discoverPromptPageProvider);
    _ref.invalidate(discoverGalleryPageProvider);
    _ref.invalidate(discoverFeedProvider);
    _ref.invalidate(assistantWorkspaceProvider);
  }
}

final userSessionCacheProvider = Provider<UserSessionCache>(
  (ref) => UserSessionCache(ref),
);
