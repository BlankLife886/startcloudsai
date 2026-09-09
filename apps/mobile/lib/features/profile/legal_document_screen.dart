import 'package:flutter/material.dart';

import '../../core/widgets/app_top_bar.dart';

enum LegalDocumentKind { terms, privacy }

class LegalSection {
  const LegalSection({required this.title, required this.body});

  final String title;
  final String body;
}

class LegalDocument {
  const LegalDocument({
    required this.title,
    required this.summary,
    required this.updatedAt,
    required this.sections,
  });

  final String title;
  final String summary;
  final String updatedAt;
  final List<LegalSection> sections;
}

const termsOfServiceDocument = LegalDocument(
  title: '用户协议',
  summary: '本协议说明账号、AI 服务、内容发布、积分与使用规范。',
  updatedAt: '2026-09-02',
  sections: [
    LegalSection(
      title: '1. 协议范围',
      body:
          '使用星空云绘即表示你理解并接受本协议。若你不同意其中任何内容，请停止注册或使用相关服务。服务规则、页面说明和付费确认信息均构成本协议的一部分。',
    ),
    LegalSection(
      title: '2. 账号与安全',
      body:
          '账号通过受支持邮箱的验证码创建和登录。请妥善保护邮箱与登录设备，不得出借、转让账号。发现陌生设备时可在“账号与安全”中撤销对应会话。因主动共享验证码或设备造成的风险由用户承担。',
    ),
    LegalSection(
      title: '3. AI 服务与结果',
      body:
          '你提交的提示词、图片和必要参数会用于完成所请求的生成或分析。AI 结果可能不准确、不完整或与预期不同，使用前应自行审核，不应将其作为医疗、法律、金融等专业领域的唯一依据。',
    ),
    LegalSection(
      title: '4. 内容与社区',
      body:
          '你应确保对上传、生成和发布的内容拥有必要权利。不得提交违法违规、侵权、欺诈、仇恨、骚扰或危害他人安全的内容。社区投稿可能经过审核，违规内容可被拒绝展示或移除。',
    ),
    LegalSection(
      title: '5. 积分、套餐与订单',
      body:
          '部分能力会消耗站内积分，提交前以页面展示的模型价格和确认信息为准。积分仅用于站内服务，不是法定货币。订单、退款或补偿按购买页面的有效规则和实际处理状态执行。',
    ),
    LegalSection(
      title: '6. 禁止行为',
      body:
          '不得绕过访问控制、批量滥用接口、攻击服务、干扰计费、冒用他人身份，或利用服务制作和传播违法内容。为保护平台与用户，我们可以限制异常请求并对严重违规账号暂停服务。',
    ),
    LegalSection(
      title: '7. 服务变更与中断',
      body: '我们会持续改进模型、功能和价格。维护、网络、上游模型或不可抗力可能导致暂时中断；重要变更会尽可能通过公告或更新记录说明。',
    ),
    LegalSection(
      title: '8. 退出与注销',
      body:
          '你可以退出当前设备，也可以在“账号与安全”中申请永久注销。注销需要邮箱验证码再次确认，并会按页面说明处理账号身份、会话、公开投稿及依法需要保留的交易和安全记录。',
    ),
    LegalSection(
      title: '9. 联系我们',
      body: '如对本协议、订单或服务处理有疑问，请通过 App“我的 > 问题反馈”提交，我们会依据问题类型进行处理。',
    ),
  ],
);

const privacyPolicyDocument = LegalDocument(
  title: '隐私政策',
  summary: '我们仅为账号、创作、交易与安全功能处理必要信息，不进行跨应用跟踪。',
  updatedAt: '2026-09-02',
  sections: [
    LegalSection(
      title: '1. 我们处理的信息',
      body:
          '为提供服务，我们会处理账号邮箱与用户标识、你主动填写的资料、提示词与上传或生成的图片、助手对话、任务记录、社区投稿、反馈、积分与订单记录，以及登录时间、IP 地址、设备客户端和必要的安全日志。',
    ),
    LegalSection(
      title: '2. 设备权限',
      body:
          '照片、相机、麦克风和语音识别仅在你使用选图、拍摄或语音输入时按需申请。拒绝权限不会影响不依赖该权限的功能；你可在“权限管理”或系统设置中随时调整。',
    ),
    LegalSection(
      title: '3. 使用目的',
      body:
          '信息用于验证登录、同步账号、执行 AI 生成和助手请求、保存与展示作品、完成订单和积分记账、处理反馈、发送业务通知、防止滥用以及排查服务故障。我们不将这些信息用于跨应用跟踪。',
    ),
    LegalSection(
      title: '4. 必要的服务提供方',
      body:
          '完成请求时，必要的提示词、图片或参数可能由模型推理、对象存储、邮件发送和支付服务提供方处理。我们仅提供完成对应功能所需的信息，并要求其按照约定目的处理。',
    ),
    LegalSection(
      title: '5. 信息共享',
      body:
          '除完成你主动请求的功能、遵守法律义务、保护用户与平台安全，或取得你的另行同意外，我们不会出售或向无关第三方共享你的个人信息。你主动发布到社区的内容会按发布范围公开展示。',
    ),
    LegalSection(
      title: '6. 存储与安全',
      body:
          '本机登录凭证保存在系统 Keychain 或 Keystore；服务端会使用访问控制、令牌哈希、传输加密和审计措施保护数据。互联网服务无法保证绝对安全，发现异常登录时请及时撤销设备会话并联系我们。',
    ),
    LegalSection(
      title: '7. 你的控制权',
      body:
          '你可以在 App 内查看和修改个人资料，管理作品、素材、投稿、通知和登录设备，导出账号数据副本，并清理本机图片缓存。符合条件时可永久注销账号；注销会再次验证当前邮箱并按注销页面说明执行。',
    ),
    LegalSection(
      title: '8. 保留与删除',
      body:
          '我们在提供服务和满足安全、争议处理及法定义务所必需的期限内保留信息。账号注销后会匿名化身份并清理会话与 API 凭证；必要订单和安全记录仅保留匿名关联。',
    ),
    LegalSection(
      title: '9. 政策更新与联系',
      body: '政策更新会通过 App 页面、公告或版本记录说明。如对个人信息处理有疑问，可通过“我的 > 问题反馈”联系我们。',
    ),
  ],
);

LegalDocument legalDocumentFor(LegalDocumentKind kind) => switch (kind) {
  LegalDocumentKind.terms => termsOfServiceDocument,
  LegalDocumentKind.privacy => privacyPolicyDocument,
};

class LegalDocumentScreen extends StatelessWidget {
  const LegalDocumentScreen({required this.kind, super.key});

  final LegalDocumentKind kind;

  @override
  Widget build(BuildContext context) {
    final document = legalDocumentFor(kind);
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppTopBar(
        title: Text(document.title),
        fallbackLocation: '/about',
      ),
      body: SelectionArea(
        child: Scrollbar(
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 40),
            itemCount: document.sections.length + 1,
            separatorBuilder: (context, index) => Divider(
              height: 32,
              color: colors.outlineVariant.withValues(alpha: .7),
            ),
            itemBuilder: (context, index) {
              if (index == 0) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      document.summary,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '更新日期：${document.updatedAt}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                );
              }
              final section = document.sections[index - 1];
              return Semantics(
                header: true,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      section.title,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      section.body,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: colors.onSurfaceVariant,
                        height: 1.65,
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
