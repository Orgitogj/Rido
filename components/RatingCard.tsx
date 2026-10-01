import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import { useApi } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { ratingReasonText, starLabel } from "@/lib/ratingText";
import { RATING_RULES, type RideRatingState } from "@/shared/contracts";

const RatingCard = ({
  rideId,
  rating,
  counterpart,
  onSaved,
}: {
  rideId: string;
  rating: RideRatingState;
  counterpart: "driver" | "passenger";
  onSaved?: (next: RideRatingState) => void;
}) => {
  const { t, tn, language, error: errorText } = useI18n();
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
  const reasonText = ratingReasonText(state.reason, language);
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
      setError(errorText(e, t("rating.saveFailed")));
    } finally {
      setSending(false);
    }
  };

  const form = !rated || editing;
  return (
    <View className="bg-white rounded-2xl p-5 mt-4">
      <Text className="text-base font-JakartaBold" accessibilityRole="header">
        {t("rating.title", {
          counterpart: t(
            counterpart === "driver"
              ? "ride.panel.rateDriver"
              : "ride.panel.ratePassenger",
          ),
        })}
      </Text>
      {!form && (
        <>
          <Text
            className="text-2xl mt-2"
            accessibilityLabel={t("rating.youRated", {
              stars: state.stars ?? 0,
            })}
          >
            {"★".repeat(state.stars ?? 0)}
            {"☆".repeat(5 - (state.stars ?? 0))}
          </Text>
          <Text className="text-xs text-general-200 mt-1">
            {t("rating.thanks")}
            {state.canEdit ? ` ${t("rating.canChange")}` : ""}
          </Text>
          {state.canEdit && (
            <CustomButton
              title={t("rating.change")}
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
                accessibilityLabel={`${tn("rating.star", n)}, ${starLabel(n, language)}`}
                className="mr-1 w-11 h-11 items-center justify-center"
              >
                <Text className="text-3xl text-[#B37E00]">
                  {n <= stars ? "★" : "☆"}
                </Text>
              </Pressable>
            ))}
          </View>
          {stars > 0 && (
            <Text className="text-xs text-general-200">
              {starLabel(stars, language)}
            </Text>
          )}
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder={t("rating.feedback")}
            multiline
            maxLength={RATING_RULES.commentMaxLength}
            accessibilityLabel={t("rating.feedback")}
            className="border border-neutral-300 rounded-xl p-3 mt-3 min-h-[70px]"
          />
          <Text className="text-xs text-general-200 mt-1">
            {t("rating.privacy")}
          </Text>
          {error && (
            <Text
              className="text-sm text-red-600 mt-2"
              accessibilityLiveRegion="polite"
            >
              {error}
            </Text>
          )}
          <CustomButton
            title={
              sending
                ? t("common.saving")
                : rated
                  ? t("rating.saveChanges")
                  : t("rating.submit")
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
