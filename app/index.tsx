import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";

const Home = () => {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return null;
  }

  return (
    <Redirect href={isSignedIn ? "/(root)/(tabs)/home" : "/(auth)/welcome"} />
  );
};

export default Home;
