import axios from "axios"; // use plain axios for login (no interceptor)
import { webApi } from "./axios/axios";

// Login (no interceptor)
export async function login(email: string, password: string) {
  const res = await axios.post("http://localhost:3000/auth/login", {
    email,
    password,
  });
  localStorage.setItem("token", res.data.data);
  return res.data; // expected { data: <token> }
}

// Profile (uses interceptor → token auto-attached)
export async function profile() {
  const res = await webApi.get("/users/profile");
  return res.data;
}
