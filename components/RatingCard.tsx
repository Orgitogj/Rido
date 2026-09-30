import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import { ApiRequestError, useApi } from "@/lib/fetch";
import { RATING_REASON_TEXT, STAR_LABELS } from "@/lib/ratingText";
import { RATING_RULES, type RideRatingState } from "@/shared/contracts";

const RatingCard = ({
  rideId,
  rating,
  counterpart,
  onSaved,
}: {
  rideId: string;
  rating: RideRatingState;
  counterpart: string;
  onSaved?: (next: RideRatingState) => void;
}) => {
  const request = useApi();
  const [state, setState] = useState(rating);
  const [editing, setEditing] = useState(false);
  const [stars, setStars] = useState(rating.stars ?? 0);
  const [comment, setComment] = useState(rating.comment ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState(rating);
    if (!editing) {
      setStars(rating.stars ?? 0);
      setComment(rating.comment ?? "");
    }
  }, [rating, editing]);

  const rated = state.stars !== null;
  const reasonText = state.reason ? RATING_REASON_TEXT[state.reason] : null;
  if (!rated && !state.eligible && !reasonText) return null;

  const submit = async () => {
    if (sending || stars < 1) return;
    setSending(true);
    setError(null);
    try {
      const next = await request<RideRatingState>(
        `/api/rides/${rideId}/rating`,
        { body: { stars, comment: comment.trim() || null } },
      );
      setState(next);
      setEditing(false);
      onSaved?.(next);
    } catch (e) {
      setError(
        e instanceof ApiRequestError ? e.message : "Couldn't save your rating.",
      );
    } finally {
      setSending(false);
    }
  };

  const form = !rated || editing;
  return (
    <View className="bg-white rounded-2xl p-5 mt-4">
      <Text className="text-base font-JakartaBold">Rate {counterpart}</Text>
      {!form && (
        <>
          <Text
            className="text-2xl mt-2"
            accessibilityLabel={`You rated ${state.stars} out of 5`}
          >
            {"★".repeat(state.stars ?? 0)}
            {"☆".repeat(5 - (state.stars ?? 0))}
          </Text>
          <Text className="text-xs text-general-200 mt-1">
            Thanks for your rating.
            {state.canEdit ? " You can still change it for a short time." : ""}
          </Text>
          {state.canEdit && (
            <CustomButton
              title="Change rating"
              bgVariant="outline"
              textVariant="primary"
              className="mt-3"
              onPress={() => setEditing(true)}
            />
          )}
        </>
      )}
      {form && !state.eligible && !rated && reasonText && (
        <Text className="text-sm text-general-200 mt-2">{reasonText}</Text>
      )}
      {form && (state.eligible || editing) && (
        <>
          <View className="flex flex-row mt-3" accessibilityRole="radiogroup">
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                onPress={() => setStars(n)}
                accessibilityRole="radio"
                accessibilityState={{ checked: stars === n }}
                accessibilityLabel={`${n} star${n === 1 ? "" : "s"}, ${STAR_LABELS[n - 1]}`}
                className="mr-2 p-1"
              >
                <Text className="text-3xl text-[#F5B400]">
                  {n <= stars ? "★" : "☆"}
                </Text>
              </Pressable>
            ))}
          </View>
          {stars > 0 && (
            <Text className="text-xs text-general-200">
              {STAR_LABELS[stars - 1]}
            </Text>
          )}
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Optional feedback"
            multiline
            maxLength={RATING_RULES.commentMaxLength}
            accessibilityLabel="Optional feedback"
            className="border border-neutral-200 rounded-xl p-3 mt-3 min-h-[70px]"
          />
          <Text className="text-xs text-general-200 mt-1">
            Written feedback is private: only our support team can read it.{" "}
            {counterpart} only sees an average rating.
          </Text>
          {error && (
            <Text
              className="text-sm text-red-500 mt-2"
              accessibilityLiveRegion="polite"
            >
              {error}
            </Text>
          )}
          <CustomButton
            title={
              sending ? "Saving…" : rated ? "Save changes" : "Submit rating"
            }
            disabled={sending || stars < 1}
            className="mt-3"
            onPress={submit}
          />
        </>
      )}
    </View>
  );
};

export default RatingCard;
