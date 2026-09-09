import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/starclouds_theme.dart';
import '../network/api_client.dart';
import '../providers.dart';

class AuthenticatedImage extends ConsumerStatefulWidget {
  const AuthenticatedImage({
    required this.url,
    this.fit = BoxFit.cover,
    this.width,
    this.height,
    this.errorChild,
    this.onError,
    this.onDecoded,
    super.key,
  });

  final String url;
  final BoxFit fit;
  final double? width;
  final double? height;
  final Widget? errorChild;
  final VoidCallback? onError;
  final ValueChanged<Size>? onDecoded;

  @override
  ConsumerState<AuthenticatedImage> createState() => _AuthenticatedImageState();
}

class _AuthenticatedImageState extends ConsumerState<AuthenticatedImage> {
  ApiClient? _client;
  Future<Map<String, String>>? _headers;
  NetworkImage? _networkImage;
  ImageStream? _sizeStream;
  ImageStreamListener? _sizeListener;
  int _attempt = 0;
  bool _failed = false;

  @override
  void dispose() {
    _unbindSizeListener();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant AuthenticatedImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url) {
      _reloadHeaders();
    }
  }

  void _bindClient(ApiClient client) {
    if (identical(_client, client)) return;
    _client = client;
    _reloadHeaders();
  }

  void _reloadHeaders() {
    _unbindSizeListener();
    _networkImage = null;
    _attempt = 0;
    _failed = false;
    _headers = _client?.authenticatedHeaders();
  }

  void _unbindSizeListener() {
    if (_sizeStream != null && _sizeListener != null) {
      _sizeStream!.removeListener(_sizeListener!);
    }
    _sizeStream = null;
    _sizeListener = null;
  }

  void _listenForSize(ImageProvider provider) {
    if (widget.onDecoded == null) return;
    final stream = provider.resolve(const ImageConfiguration());
    if (identical(_sizeStream, stream)) return;
    _unbindSizeListener();
    _sizeListener = ImageStreamListener((info, _) {
      final callback = widget.onDecoded;
      if (callback == null) return;
      final size = Size(
        info.image.width.toDouble(),
        info.image.height.toDouble(),
      );
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        callback(size);
      });
    });
    _sizeStream = stream;
    stream.addListener(_sizeListener!);
  }

  String _retryableUrl(String value) {
    if (_attempt == 0) return value;
    final uri = Uri.tryParse(value);
    if (uri == null || !uri.hasScheme) return value;
    return uri
        .replace(
          queryParameters: {
            ...uri.queryParameters,
            '_mobile_image_retry': '$_attempt',
          },
        )
        .toString();
  }

  void _markFailed() {
    if (_failed) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _failed) return;
      setState(() => _failed = true);
      widget.onError?.call();
    });
  }

  Widget _failure() => widget.errorChild ?? _ImageFailure(onRetry: _retry);

  Future<void> _retry() async {
    final client = _client;
    if (client == null) return;
    final failedImage = _networkImage;
    if (failedImage != null) {
      await failedImage.evict();
    }
    if (!mounted) return;
    setState(() {
      _attempt += 1;
      _failed = false;
      _networkImage = null;
      _headers = client.authenticatedHeaders();
    });
  }

  @override
  Widget build(BuildContext context) {
    final client = ref.watch(apiClientProvider);
    _bindClient(client);
    final resolved = client.resolveUrl(widget.url);
    if (resolved.isEmpty) {
      return _failure();
    }
    if (_failed) return _failure();
    return FutureBuilder<Map<String, String>>(
      future: _headers,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const _ImageLoading();
        }
        if (snapshot.hasError) {
          _markFailed();
          return _failure();
        }
        final provider = NetworkImage(
          _retryableUrl(resolved),
          headers: snapshot.data,
        );
        _networkImage = provider;
        _listenForSize(provider);
        return Image(
          key: ValueKey('authenticated-image-${widget.url}-$_attempt'),
          image: provider,
          width: widget.width,
          height: widget.height,
          fit: widget.fit,
          gaplessPlayback: true,
          filterQuality: FilterQuality.medium,
          errorBuilder: (context, error, stackTrace) {
            _markFailed();
            return _failure();
          },
          loadingBuilder: (context, child, progress) =>
              progress == null ? child : const _ImageLoading(),
        );
      },
    );
  }
}

class _ImageLoading extends StatelessWidget {
  const _ImageLoading();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final visual = StarCloudsVisualStyle.of(context);
    return ColoredBox(
      color: colors.surfaceContainerHigh,
      child: Center(
        child: Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: visual.brandSoft,
            shape: BoxShape.circle,
          ),
          child: Icon(Icons.image_outlined, size: 17, color: colors.primary),
        ),
      ),
    );
  }
}

class _ImageFailure extends StatelessWidget {
  const _ImageFailure({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final visual = StarCloudsVisualStyle.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final textScale = MediaQuery.textScalerOf(context).scale(1);
        final roomy =
            constraints.hasBoundedWidth &&
            constraints.hasBoundedHeight &&
            constraints.maxWidth / textScale >= 150 &&
            constraints.maxHeight / textScale >= 120;
        final content = Center(
          child: Padding(
            padding: EdgeInsets.all(roomy ? 12 : 4),
            child: roomy
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          color: visual.brandSoft,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.refresh_rounded,
                          color: colors.primary,
                          size: 22,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '图片加载失败',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '点击重新加载',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  )
                : Icon(
                    Icons.refresh_rounded,
                    color: colors.onSurfaceVariant,
                    size: 20,
                  ),
          ),
        );
        return Material(
          key: const Key('authenticated-image-failure'),
          color: colors.surfaceContainerHigh,
          child: roomy
              ? InkWell(
                  key: const Key('authenticated-image-retry'),
                  onTap: onRetry,
                  child: content,
                )
              : IgnorePointer(child: content),
        );
      },
    );
  }
}
