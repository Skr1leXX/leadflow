import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Страница не найдена</h1>
        <Button className="mt-6" nativeButton={false} render={<Link href="/" />}>
          На главную
        </Button>
      </div>
    </div>
  );
}
