import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";
import { StatusShowcase, goToPreviousPage } from "../../../components/status/StatusShowcase.jsx";

export default function NotFound() {
    const navigate = useNavigate();
    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <StatusShowcase
                kind="notfound"
                actions={(
                    <button className="is-primary" type="button" onClick={() => goToPreviousPage(navigate)}>
                        <ArrowLeft className="size-4" />
                        返回上一页
                    </button>
                )}
            />
        </div>
    );
}
