"use client";

import { useState } from "react";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { useT } from "../../../components/i18n/FournisseurLangue";
import { Bouton } from "../../../components/ui/Bouton";
import { api } from "../../../lib/api";

/** Installe les grades et types de mission de conseil de départ (idempotent côté API). */
export function InstallationCatalogue() {
  const t = useT();
  const pluriel = (n: number, un: string, plusieurs: string, unEn: string, plusieursEn: string) =>
    `${n} ${n > 1 ? t(plusieurs, plusieursEn) : t(un, unEn)}`;
  const f = useFormulaire<never>();
  const [resultat, setResultat] = useState<string | null>(null);

  const installer = () =>
    f.envoyer(
      { ok: true, charge: null },
      () => api.post<{ grades: number; types: number }>("/api/catalogue/semer-conseil"),
      {
        apres: (r) =>
          setResultat(
            r.grades === 0 && r.types === 0
              ? t(
                  "Le catalogue de conseil était déjà installé : rien n'a été ajouté.",
                  "The consulting catalog was already installed: nothing was added.",
                )
              : `${t("Ajouté : ", "Added: ")}${pluriel(r.grades, "grade", "grades", "grade", "grades")}${t(" et ", " and ")}${pluriel(r.types, "type de mission", "types de mission", "engagement type", "engagement types")}${t(". Ces valeurs de départ sont à valider par le cabinet.", ". These starting values must be approved by the firm.")}`,
          ),
      },
    );

  return (
    <div className="mp-pile">
      <p>
        {t(
          "Ajoute des grades (junior, senior, manager…) et des types de mission courants (plan stratégique, audit organisationnel…) avec leur découpage. Les éléments déjà présents ne sont pas modifiés.",
          "Adds grades (junior, senior, manager…) and common engagement types (strategic plan, organizational audit…) with their work breakdown. Existing items are not modified.",
        )}
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={resultat}
        refAlerte={f.refAlerte}
        titreErreur={t("Installation impossible", "Installation failed")}
      />
      <div>
        <Bouton
          variante="secondaire"
          icone="livre"
          chargement={f.enCours}
          texteChargement={t("Installation…", "Installing…")}
          onClick={installer}
        >
          {t("Installer le catalogue de conseil", "Install the consulting catalog")}
        </Bouton>
      </div>
    </div>
  );
}
