"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
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
  const [titre, setTitre] = useState(`${intitule} (copie)`.slice(0, 200));
  const [client, setClient] = useState("");
  const f = useFormulaire<"intitule" | "client_id">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerDuplication(titre, client),
      (c) => api.post<Mission>(`/api/missions/${encodeURIComponent(missionId)}/dupliquer`, c),
      {
        rafraichir: false,
        apres: (m) => {
          router.push(`/missions/${m.id}`);
          router.refresh();
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
      aria-label="Dupliquer la mission"
    >
      <p className="mp-sous-formulaire__titre">Dupliquer la mission</p>
      <p className="mp-texte-doux">
        La copie reprend le découpage, les jours budgétés et les dépendances, sans dates ni budget
        signé.
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Duplication impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Intitulé de la copie"
          required
          maxLength={200}
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          erreur={f.erreurs.intitule}
        />
        <Select
          libelle="Client de la copie"
          options={clients}
          invite="Même client"
          value={client}
          onChange={(e) => setClient(e.target.value)}
          erreur={f.erreurs.client_id}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="copie" chargement={f.enCours} texteChargement="Duplication…">
          Créer la copie
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
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
  const [libelle, setLibelle] = useState(intitule.slice(0, 160));
  const [code, setCode] = useState(codeDepuisLibelle(intitule));
  const f = useFormulaire<"code" | "libelle">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerModele(code, libelle),
      (c) => api.post<{ id: string }>(`/api/missions/${encodeURIComponent(missionId)}/modele`, c),
      { rafraichir: false, apres: (t) => router.push(`/catalogue/${t.id}`) },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Enregistrer comme modèle"
    >
      <p className="mp-sous-formulaire__titre">Enregistrer comme type de mission</p>
      <p className="mp-texte-doux">
        Le découpage et les jours par grade deviennent un nouveau type du catalogue.
      </p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Code du type"
          required
          maxLength={40}
          autoCapitalize="none"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          erreur={f.erreurs.code}
          aide="Minuscules, chiffres et tiret bas."
        />
        <Champ
          libelle="Libellé du type"
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
          texteChargement="Enregistrement…"
        >
          Enregistrer le modèle
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
