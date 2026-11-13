"use client";

import { useRouter } from "next/navigation";
import { useRafraichir } from "../../../../components/formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../../components/ui/Select";
import { api } from "../../../../lib/api";
import {
  codeDepuisLibelle,
  validerDuplication,
  validerModele,
  type Mission,
} from "../../../../lib/missions";

export function Duplication({
  missionId,
  intitule,
  clients,
  onFin,
}: {
  missionId: string;
  intitule: string;
  clients: readonly OptionSelect[];
  onFin: () => void;
}) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [titre, setTitre] = useState(`${intitule} (copie)`.slice(0, 200));
  const [client, setClient] = useState("");
  const f = useFormulaire<"intitule" | "client_id">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerDuplication(titre, client, langue),
      (c) => api.post<Mission>(`/api/missions/${encodeURIComponent(missionId)}/dupliquer`, c),
      {
        rafraichir: false,
        apres: (m) => {
          router.push(`/missions/${m.id}`);
          rafraichir();
        },
      },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Dupliquer la mission", "Duplicate the engagement")}
    >
      <p className="mp-sous-formulaire__titre">
        {t("Dupliquer la mission", "Duplicate the engagement")}
      </p>
      <p className="mp-texte-doux">
        {t(
          "La copie reprend le découpage, les jours budgétés et les dépendances, sans dates ni budget signé.",
          "The copy keeps the work breakdown, budgeted days and dependencies, without dates or signed budget.",
        )}
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Duplication impossible", "Duplication not possible")}
      />
      <div className="mp-grille-champs mp-grille-champs--bas">
        <Champ
          libelle={t("Intitulé de la copie", "Title of the copy")}
          required
          maxLength={200}
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          erreur={f.erreurs.intitule}
        />
        <Select
          libelle={t("Client de la copie", "Client of the copy")}
          options={clients}
          invite={t("Même client", "Same client")}
          value={client}
          onChange={(e) => setClient(e.target.value)}
          erreur={f.erreurs.client_id}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="copie"
          chargement={f.enCours}
          texteChargement={t("Duplication…", "Duplicating…")}
        >
          {t("Créer la copie", "Create the copy")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

export function Modele({
  missionId,
  intitule,
  onFin,
}: {
  missionId: string;
  intitule: string;
  onFin: () => void;
}) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const [libelle, setLibelle] = useState(intitule.slice(0, 160));
  const [code, setCode] = useState(codeDepuisLibelle(intitule));
  const f = useFormulaire<"code" | "libelle">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerModele(code, libelle, langue),
      (c) => api.post<{ id: string }>(`/api/missions/${encodeURIComponent(missionId)}/modele`, c),
      { rafraichir: false, apres: (cree) => router.push(`/catalogue/${cree.id}`) },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Enregistrer comme modèle", "Save as template")}
    >
      <p className="mp-sous-formulaire__titre">
        {t("Enregistrer comme type de mission", "Save as an engagement type")}
      </p>
      <p className="mp-texte-doux">
        {t(
          "Le découpage et les jours par grade deviennent un nouveau type du catalogue.",
          "The work breakdown and days by grade become a new catalog type.",
        )}
      </p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs mp-grille-champs--bas">
        <Champ
          libelle={t("Code du type", "Type code")}
          required
          maxLength={40}
          autoCapitalize="none"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          erreur={f.erreurs.code}
          aide={t(
            "Minuscules, chiffres et tiret bas.",
            "Lowercase letters, digits and underscores.",
          )}
        />
        <Champ
          libelle={t("Libellé du type", "Type label")}
          required
          maxLength={160}
          value={libelle}
          onChange={(e) => setLibelle(e.target.value)}
          erreur={f.erreurs.libelle}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="livre"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer le modèle", "Save the template")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
