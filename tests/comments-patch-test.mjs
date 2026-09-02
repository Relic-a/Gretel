import assert from "node:assert/strict";
import test from "node:test";
import { Innertube, Parser } from "youtubei.js";

const CommentView = Parser.getParserByName("CommentView");

test("CommentView handles modern YouTube comment payload without avatar object", () => {
  assert.ok(CommentView, "CommentView class must be resolved from Parser");

  const commentView = new CommentView({
    commentId: "UgxTestCommentId123",
    commentKey: "key_comment_1",
    commentSurfaceKey: "key_surface_1",
    toolbarStateKey: "key_state_1",
    toolbarSurfaceKey: "key_toolbar_1",
    sharedKey: "key_shared_1"
  });

  // Modern YouTube response: avatar object is completely absent from commentEntityPayload.
  // The avatar URL and channel link live inside author as avatarThumbnailUrl and channelCommand.
  const modernCommentPayload = {
    properties: {
      content: {
        content: "Hello world from modern YouTube comment format!"
      },
      publishedTime: "3 hours ago"
    },
    author: {
      displayName: "@Tester",
      avatarThumbnailUrl: "https://yt3.ggpht.com/test-avatar-hash=s88-c-k-c0x00ffffff-no-rj",
      channelCommand: {
        browseEndpoint: {
          browseId: "UC_MODERN_AUTHOR_ID"
        }
      },
      channelId: "UC_MODERN_AUTHOR_ID"
    },
    toolbar: {
      creatorThumbnailUrl: "https://yt3.ggpht.com/creator-thumb.jpg",
      likeCountNotliked: "15",
      likeCountLiked: "16"
    }
  };

  // Prior to patch, this threw:
  // TypeError: Cannot read properties of undefined (reading 'endpoint')
  assert.doesNotThrow(() => {
    commentView.applyMutations(modernCommentPayload);
  });

  assert.equal(commentView.author?.name, "@Tester");
  assert.equal(commentView.author?.id, "UC_MODERN_AUTHOR_ID");
  assert.equal(commentView.author?.thumbnails?.length, 1);
  assert.equal(
    commentView.author?.thumbnails?.[0]?.url,
    "https://yt3.ggpht.com/test-avatar-hash=s88-c-k-c0x00ffffff-no-rj"
  );
  assert.equal(commentView.author?.thumbnails?.[0]?.width, 88);
  assert.equal(commentView.author?.thumbnails?.[0]?.height, 88);
  assert.equal(commentView.like_count, "15");
  assert.equal(commentView.published_time, "3 hours ago");
  assert.equal(
    commentView.content?.toString(),
    "Hello world from modern YouTube comment format!"
  );
});

test("CommentView preserves backward compatibility with legacy payloads containing avatar", () => {
  const commentView = new CommentView({
    commentId: "UgxLegacyCommentId456",
    commentKey: "key_comment_2"
  });

  const legacyCommentPayload = {
    properties: {
      content: {
        content: "Legacy comment format"
      },
      publishedTime: "1 year ago"
    },
    author: {
      displayName: "@LegacyUser",
      channelId: "UC_LEGACY_AUTHOR_ID"
    },
    avatar: {
      endpoint: {
        browseEndpoint: {
          browseId: "UC_LEGACY_AUTHOR_ID"
        }
      },
      image: {
        thumbnails: [
          {
            url: "https://yt3.ggpht.com/legacy-avatar.jpg",
            width: 48,
            height: 48
          }
        ]
      }
    },
    toolbar: {
      creatorThumbnailUrl: "",
      likeCountNotliked: "99"
    }
  };

  assert.doesNotThrow(() => {
    commentView.applyMutations(legacyCommentPayload);
  });

  assert.equal(commentView.author?.name, "@LegacyUser");
  assert.equal(commentView.author?.id, "UC_LEGACY_AUTHOR_ID");
  assert.equal(commentView.author?.thumbnails?.length, 1);
  assert.equal(
    commentView.author?.thumbnails?.[0]?.url,
    "https://yt3.ggpht.com/legacy-avatar.jpg"
  );
});

test("Innertube getComments live fetch retrieves comments and continuations without crashing", async () => {
  const yt = await Innertube.create();
  // Video with comments: Pg72m3CjuK4 (present in user's reproduction log)
  const commentsPage = await yt.getComments("Pg72m3CjuK4");

  assert.ok(commentsPage, "Comments page should be returned");
  assert.ok(Array.isArray(commentsPage.contents), "Contents should be an array");
  assert.ok(commentsPage.contents.length > 0, "Should retrieve comments");

  const firstThread = commentsPage.contents[0];
  assert.ok(firstThread?.comment, "Thread should have comment");
  assert.ok(firstThread.comment.author?.name, "Comment must have author name");
  assert.ok(
    firstThread.comment.author?.thumbnails?.length > 0,
    "Comment author should have avatar thumbnail parsed from fallback"
  );

  if (commentsPage.has_continuation) {
    const continuationPage = await commentsPage.getContinuation();
    assert.ok(continuationPage, "Continuation page should resolve");
    assert.ok(
      Array.isArray(continuationPage.contents),
      "Continuation contents should be an array"
    );
  }
});
